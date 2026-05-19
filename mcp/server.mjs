#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium } from "playwright";
import WebSocket from "ws";
import * as z from "zod/v4";

const DEFAULT_VIEWER_URL = "http://127.0.0.1:5173/";
const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:8787";
const viewerUrl = process.env.LEAPS_VIEWER_URL || DEFAULT_VIEWER_URL;
const bridgeUrl = process.env.LEAPS_BRIDGE_URL || DEFAULT_BRIDGE_URL;
const useBridge = process.env.LEAPS_MCP_TRANSPORT !== "playwright";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sessionId = `leaps-viewer-${Date.now().toString(36)}`;
const operationHistory = [];

let viteProcess = null;
let bridgeProcess = null;
let bridgeSocket = null;
let bridgeRegistered = false;
let bridgeRequestCounter = 0;
const bridgePending = new Map();
let browser = null;
let page = null;

const server = new McpServer({
  name: "leaps-image-viewer",
  version: "0.1.0",
});

server.registerTool(
  "viewer_open_sample",
  {
    description: "Open one of the built-in public-safe viewer samples.",
    inputSchema: {
      sample: z.enum(["chart", "bayer", "bad-pixel", "compare-video", "compare-bayer"]).default("chart"),
    },
  },
  async ({ sample }) => jsonResult(await openSample(sample)),
);

server.registerTool(
  "viewer_get_state",
  {
    description: "Return the current LEaps viewer state, including frame, viewport, compare, and saved regions.",
    inputSchema: {},
  },
  async () => jsonResult(await callViewer("getState")),
);

server.registerTool(
  "viewer_observe",
  {
    description: "Observe the current stateful viewer session after previous tool interactions. Returns state, visible image rect, selected ROI stats/loss, and recent operation history.",
    inputSchema: {
      includeScreenshot: z.boolean().default(false),
      screenshotSource: z.enum(["canvas", "rendered-image", "tone-mapped-image"]).default("canvas"),
      historyLimit: z.number().int().min(0).max(50).default(12),
    },
  },
  async ({ includeScreenshot, screenshotSource, historyLimit }) => {
    const observation = await callViewer("observe", { includeScreenshot, screenshotSource }, { record: false });
    const screenshot = extractScreenshot(observation);
    const payload = withSession({
      ...observation,
      operationHistory: recentOperations(historyLimit),
    });
    const content = [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ];
    if (screenshot) {
      content.push({
        type: "image",
        mimeType: screenshot.mimeType,
        data: screenshot.data,
      });
    }
    return {
      content,
      structuredContent: payload,
    };
  },
);

server.registerTool(
  "viewer_set_view_mode",
  {
    description: "Set Bayer display mode for the active image viewer.",
    inputSchema: {
      mode: z.enum([
        "demosaic-preview",
        "raw-mosaic",
        "cfa-false-color",
        "plane-r",
        "plane-gr",
        "plane-gb",
        "plane-b",
      ]),
    },
  },
  async ({ mode }) => jsonResult(await callViewer("setViewMode", mode)),
);

server.registerTool(
  "viewer_set_brightness",
  {
    description: "Set viewer brightness as a linear multiplier.",
    inputSchema: {
      multiplier: z.number().positive(),
    },
  },
  async ({ multiplier }) => jsonResult(await callViewer("setBrightness", multiplier)),
);

server.registerTool(
  "viewer_set_white_balance",
  {
    description: "Set Bayer white-balance gains for R/G/B planes.",
    inputSchema: {
      r: z.number().min(0).max(8),
      g: z.number().min(0).max(8),
      b: z.number().min(0).max(8),
    },
  },
  async (gains) => jsonResult(await callViewer("setWhiteBalance", gains)),
);

server.registerTool(
  "viewer_get_pixel",
  {
    description: "Read one image-coordinate pixel from the active image or compare view.",
    inputSchema: {
      x: z.number().int().describe("Zero-based image column."),
      y: z.number().int().describe("Zero-based image row."),
    },
  },
  async ({ x, y }) => jsonResult(await callViewer("getPixel", { x, y })),
);

server.registerTool(
  "viewer_get_roi_stats",
  {
    description: "Read image-coordinate ROI statistics. For Bayer frames this includes per-CFA-plane stats.",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    },
  },
  async (roi) => jsonResult(await callViewer("getRoiStats", roi)),
);

server.registerTool(
  "viewer_select_region",
  {
    description: "Select an image-coordinate ROI in the viewer. Coordinates are zero-based image pixels.",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    },
  },
  async (roi) => jsonResult(await callViewer("selectRegion", roi)),
);

server.registerTool(
  "viewer_save_current_region",
  {
    description: "Save the currently selected ROI with an optional agent-facing description.",
    inputSchema: {
      description: z.string().default(""),
      label: z.string().default(""),
    },
  },
  async ({ description, label }) => jsonResult(await callViewer("saveCurrentRegion", { description, label })),
);

server.registerTool(
  "viewer_add_marker",
  {
    description: "Add an image-coordinate marker to the viewer.",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      label: z.string().default(""),
    },
  },
  async (marker) => jsonResult(await callViewer("addMarker", marker)),
);

server.registerTool(
  "viewer_focus_selected_region",
  {
    description: "Zoom the viewer so the currently selected ROI fills the active viewport.",
    inputSchema: {},
  },
  async () => jsonResult(await callViewer("focusSelectedRegion")),
);

server.registerTool(
  "viewer_zoom",
  {
    description: "Zoom the active viewer viewport by a factor, optionally around an image or screen point.",
    inputSchema: {
      factor: z.number().positive().default(1.25),
      centerImage: z.object({
        x: z.number(),
        y: z.number(),
      }).optional(),
      centerScreen: z.object({
        x: z.number(),
        y: z.number(),
      }).optional(),
    },
  },
  async (options) => jsonResult(await callViewer("zoom", cleanUndefined(options))),
);

server.registerTool(
  "viewer_fit",
  {
    description: "Fit the active image or compare view into the viewer viewport.",
    inputSchema: {},
  },
  async () => jsonResult(await callViewer("fit")),
);

server.registerTool(
  "viewer_pan",
  {
    description: "Pan the active viewer viewport by screen-pixel deltas.",
    inputSchema: {
      dx: z.number().default(0),
      dy: z.number().default(0),
    },
  },
  async (options) => jsonResult(await callViewer("pan", options)),
);

server.registerTool(
  "viewer_set_viewport",
  {
    description: "Set the active viewport directly with scale and screen-pixel offsets.",
    inputSchema: {
      scale: z.number().positive(),
      offsetX: z.number(),
      offsetY: z.number(),
    },
  },
  async (viewport) => jsonResult(await callViewer("setViewport", viewport)),
);

server.registerTool(
  "viewer_screenshot",
  {
    description: "Return a PNG screenshot from the viewer canvas or rendered image.",
    inputSchema: {
      source: z.enum(["canvas", "rendered-image", "tone-mapped-image"]).default("canvas"),
    },
  },
  async ({ source }) => {
    const dataUrl = await callViewer("screenshot", { source });
    const match = /^data:(image\/png);base64,(.+)$/u.exec(dataUrl);
    if (!match) {
      throw new Error("Viewer did not return a PNG data URL.");
    }
    return {
      content: [
        {
          type: "image",
          mimeType: match[1],
          data: match[2],
        },
      ],
    };
  },
);

server.registerTool(
  "viewer_compare_find_worst_regions",
  {
    description: "In compare mode, find high-loss ROI candidates over the current loss map.",
    inputSchema: {
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      topK: z.number().int().positive().max(20).default(5),
      step: z.number().int().positive().optional(),
    },
  },
  async (options) => jsonResult(await callCompare("findWorstRegions", cleanUndefined(options))),
);

server.registerTool(
  "viewer_compare_get_roi_loss",
  {
    description: "In compare mode, compute loss for an ROI in image coordinates.",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    },
  },
  async (roi) => jsonResult(await callCompare("getRoiLoss", roi)),
);

async function openSample(sample) {
  const methodBySample = {
    chart: "openChartSample",
    bayer: "openSampleBayer",
    "bad-pixel": "openBadPixelSample",
  };
  if (sample === "compare-video") {
    return callCompare("openSample");
  }
  if (sample === "compare-bayer") {
    return callCompare("openSampleBayer");
  }
  return callViewer(methodBySample[sample]);
}

async function callViewer(method, argument, options = {}) {
  const result = useBridge
    ? await sendBridgeCommand("viewer", method, argument)
    : await callViewerWithPlaywright(method, argument);
  if (options.record !== false) {
    recordOperation(`viewer.${method}`, argument, summarizeResult(result));
  }
  return result;
}

async function callCompare(method, argument, options = {}) {
  const result = useBridge
    ? await sendBridgeCommand("compare", method, argument)
    : await callCompareWithPlaywright(method, argument);
  if (options.record !== false) {
    recordOperation(`compare.${method}`, argument, summarizeResult(result));
  }
  return result;
}

async function callViewerWithPlaywright(method, argument) {
  const activePage = await ensurePage();
  return activePage.evaluate(
    async ({ methodName, value }) => {
      const api = window.LEapsViewer;
      if (!api || typeof api[methodName] !== "function") {
        throw new Error(`window.LEapsViewer.${methodName} is not available.`);
      }
      return api[methodName](value);
    },
    { methodName: method, value: argument },
  );
}

async function callCompareWithPlaywright(method, argument) {
  const activePage = await ensurePage();
  return activePage.evaluate(
    async ({ methodName, value }) => {
      const api = window.LEapsViewer?.compare;
      if (!api || typeof api[methodName] !== "function") {
        throw new Error(`window.LEapsViewer.compare.${methodName} is not available.`);
      }
      return api[methodName](value);
    },
    { methodName: method, value: argument },
  );
}

async function sendBridgeCommand(scope, method, argument) {
  const socket = await ensureBridgeSocket();
  return sendBridgeCommandRaw(socket, scope, method, argument);
}

async function sendBridgeCommandRaw(socket, scope, method, argument) {
  const id = `cmd-${++bridgeRequestCounter}-${randomUUID()}`;
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridgePending.delete(id);
      reject(new Error(`Bridge command timed out: ${scope}.${method}`));
    }, 20000);
    bridgePending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({
      type: "command",
      id,
      command: { scope, method, argument },
    }));
  });
  if (!response.ok) {
    throw new Error(response.error || `Bridge command failed: ${scope}.${method}`);
  }
  return response.result;
}

async function ensureBridgeSocket() {
  await ensureViewerServer();
  await ensureBridgeServer();
  if (bridgeSocket?.readyState === WebSocket.OPEN && bridgeRegistered) return bridgeSocket;

  bridgeSocket = new WebSocket(bridgeUrl);
  bridgeRegistered = false;
  bridgeSocket.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.type === "registered") {
      bridgeRegistered = true;
      return;
    }
    if (message.type === "response") {
      const request = bridgePending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      bridgePending.delete(message.id);
      request.resolve(message);
    }
  });
  bridgeSocket.on("close", () => {
    bridgeRegistered = false;
  });
  await new Promise((resolve, reject) => {
    bridgeSocket.once("open", resolve);
    bridgeSocket.once("error", reject);
  });
  bridgeSocket.send(JSON.stringify({
    type: "register-mcp",
    clientId: sessionId,
  }));

  const deadline = Date.now() + 10000;
  while (!bridgeRegistered && Date.now() < deadline) {
    await delay(50);
  }
  if (!bridgeRegistered) throw new Error("MCP bridge registration timed out.");

  await ensureBridgeViewer();
  return bridgeSocket;
}

async function ensureBridgeServer() {
  if (await bridgeAvailable()) return;
  if (!bridgeProcess) {
    const nodeCommand = process.execPath;
    bridgeProcess = spawn(nodeCommand, ["bridge/server.mjs"], {
      cwd: projectRoot,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env },
    });
    bridgeProcess.stderr.on("data", (chunk) => {
      process.stderr.write(`[viewer-bridge] ${chunk}`);
    });
    bridgeProcess.on("exit", (code) => {
      bridgeProcess = null;
      if (code && code !== 0) process.stderr.write(`[viewer-bridge] exited with code ${code}\n`);
    });
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await bridgeAvailable()) return;
    await delay(100);
  }
  throw new Error(`Bridge server did not become available at ${bridgeUrl}`);
}

async function bridgeAvailable() {
  const probe = new WebSocket(bridgeUrl);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      probe.close();
      resolve(false);
    }, 500);
    probe.once("open", () => {
      clearTimeout(timer);
      probe.close();
      resolve(true);
    });
    probe.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function ensureBridgeViewer() {
  const initial = await sendBridgeCommandIfViewer("viewer", "getState");
  if (initial.ok) return;

  await ensurePage();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await sendBridgeCommandIfViewer("viewer", "getState");
    if (result.ok) return;
    await delay(250);
  }
  throw new Error("No viewer connected to bridge.");
}

async function sendBridgeCommandIfViewer(scope, method, argument) {
  try {
    const result = await sendBridgeCommandRaw(bridgeSocket, scope, method, argument);
    return { ok: true, result };
  } catch (error) {
    if (/No viewer is connected/i.test(error.message)) return { ok: false };
    throw error;
  }
}

async function ensurePage() {
  await ensureViewerServer();
  if (!browser) {
    browser = await chromium.launch({ headless: process.env.LEAPS_VIEWER_HEADLESS !== "0" });
  }
  if (!page || page.isClosed()) {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(viewerUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.LEapsViewer), { timeout: 15000 });
  }
  return page;
}

async function ensureViewerServer() {
  if (await urlAvailable(viewerUrl)) return;

  if (!viteProcess) {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    viteProcess = spawn(npmCommand, ["run", "dev", "--", "--host", "127.0.0.1"], {
      cwd: projectRoot,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, BROWSER: "none" },
    });
    viteProcess.stderr.on("data", (chunk) => {
      process.stderr.write(`[viewer-dev] ${chunk}`);
    });
    viteProcess.on("exit", (code) => {
      viteProcess = null;
      if (code && code !== 0) {
        process.stderr.write(`[viewer-dev] exited with code ${code}\n`);
      }
    });
  }

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await urlAvailable(viewerUrl)) return;
    await delay(250);
  }
  throw new Error(`Viewer dev server did not become available at ${viewerUrl}`);
}

async function urlAvailable(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function jsonResult(value) {
  const payload = withSession(value && typeof value === "object" ? value : { value });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function withSession(value) {
  const session = {
    session: {
      id: sessionId,
      viewerUrl,
      operationCount: operationHistory.length,
    },
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...session, result: value };
  }
  return { ...session, ...value };
}

function recordOperation(name, argument, resultSummary) {
  operationHistory.push({
    index: operationHistory.length + 1,
    timestamp: new Date().toISOString(),
    name,
    argument: argument ?? null,
    resultSummary,
  });
  if (operationHistory.length > 100) {
    operationHistory.splice(0, operationHistory.length - 100);
  }
}

function recentOperations(limit) {
  return operationHistory.slice(-limit);
}

function summarizeResult(result) {
  if (!result || typeof result !== "object") return { value: result };
  if (result.frame || result.state) {
    return {
      mode: result.mode || result.state?.mode,
      sourceName: result.sourceName || result.state?.sourceName,
      frame: result.frame || result.state?.frame,
      selection: result.selection || result.selectedRegion || result.state?.selection,
    };
  }
  if (Number.isFinite(result.x) && Number.isFinite(result.y)) {
    return {
      x: result.x,
      y: result.y,
      width: result.width,
      height: result.height,
      kind: result.kind,
      count: result.count,
    };
  }
  return {
    keys: Object.keys(result).slice(0, 12),
  };
}

function extractScreenshot(observation) {
  const dataUrl = observation?.screenshotDataUrl;
  if (!dataUrl) return null;
  delete observation.screenshotDataUrl;
  const match = /^data:(image\/png);base64,(.+)$/u.exec(dataUrl);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

async function shutdown() {
  bridgeSocket?.close();
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (bridgeProcess) {
    bridgeProcess.kill();
  }
  if (viteProcess) {
    viteProcess.kill();
  }
}

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`LEaps Image Viewer MCP server ready for ${viewerUrl} via ${useBridge ? bridgeUrl : "playwright"}\n`);
