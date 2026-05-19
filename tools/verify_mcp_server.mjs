import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({
  name: "leaps-image-viewer-mcp-smoke",
  version: "0.1.0",
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["mcp/server.mjs"],
  cwd: process.cwd(),
  stderr: "pipe",
});

transport.stderr?.on("data", (chunk) => {
  process.stderr.write(String(chunk));
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const name of ["viewer_open_sample", "viewer_observe", "viewer_get_pixel", "viewer_get_roi_stats"]) {
    if (!names.has(name)) {
      throw new Error(`Missing MCP tool: ${name}`);
    }
  }

  await client.callTool({
    name: "viewer_open_sample",
    arguments: { sample: "chart" },
  });

  const firstObservation = await client.callTool({
    name: "viewer_observe",
    arguments: { historyLimit: 4 },
  });
  const firstObservationPayload = JSON.parse(firstObservation.content?.[0]?.text || "null");
  if (!firstObservationPayload?.session?.id || !firstObservationPayload?.visibleImageRect) {
    throw new Error("Observe tool did not return session and visible image rect.");
  }

  const pixel = await client.callTool({
    name: "viewer_get_pixel",
    arguments: { x: 250, y: 215 },
  });
  const pixelPayload = JSON.parse(pixel.content?.[0]?.text || "null");
  if (pixelPayload?.x !== 250 || pixelPayload?.y !== 215) {
    throw new Error("Pixel tool did not return the expected coordinate.");
  }

  const roi = await client.callTool({
    name: "viewer_get_roi_stats",
    arguments: { x: 20, y: 20, width: 32, height: 32 },
  });
  const roiPayload = JSON.parse(roi.content?.[0]?.text || "null");
  if (!Number.isFinite(roiPayload?.count)) {
    throw new Error("ROI stats tool did not return a count.");
  }

  const selected = await client.callTool({
    name: "viewer_select_region",
    arguments: { x: 340, y: 35, width: 90, height: 70 },
  });
  const selectedPayload = JSON.parse(selected.content?.[0]?.text || "null");
  if (selectedPayload?.width !== 90) {
    throw new Error("Select region tool did not return the selected ROI.");
  }

  await client.callTool({
    name: "viewer_add_marker",
    arguments: { x: 385, y: 68, label: "face-like" },
  });

  const secondObservation = await client.callTool({
    name: "viewer_observe",
    arguments: { historyLimit: 10 },
  });
  const secondObservationPayload = JSON.parse(secondObservation.content?.[0]?.text || "null");
  if (
    secondObservationPayload?.selectedRegion?.width !== 90 ||
    !secondObservationPayload.operationHistory?.some((entry) => entry.name === "viewer.addMarker")
  ) {
    throw new Error("Observe tool did not preserve selected ROI and operation history.");
  }

  console.log(`MCP smoke OK: ${tools.tools.length} tools registered.`);
} finally {
  await client.close();
}
