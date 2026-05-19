#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium } from "playwright";
import * as z from "zod/v4";

const DEFAULT_VIEWER_URL = "http://127.0.0.1:5173/";
const viewerUrl = process.env.LEAPS_VIEWER_URL || DEFAULT_VIEWER_URL;
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

let viteProcess = null;
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
  "viewer_focus_selected_region",
  {
    description: "Zoom the viewer so the currently selected ROI fills the active viewport.",
    inputSchema: {},
  },
  async () => jsonResult(await callViewer("focusSelectedRegion")),
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

async function callViewer(method, argument) {
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

async function callCompare(method, argument) {
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
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value && typeof value === "object" ? value : { value },
  };
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

async function shutdown() {
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
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
process.stderr.write(`LEaps Image Viewer MCP server ready for ${viewerUrl}\n`);
