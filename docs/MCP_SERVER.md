# LEaps Image Viewer MCP Server

This repository includes a local MCP server that lets model agents drive the viewer through tool calls.

The preferred path is:

```text
agent -> MCP tools -> WebSocket bridge -> viewer runtime
```

The viewer connects to the bridge and executes commands through `window.LEapsViewer`. This keeps the agent interaction focused on tools and viewer state instead of browser UI automation. If no viewer is connected, the MCP server can still open a headless Playwright page as a fallback so automation keeps working.

## Run

This project uses a project-local `.mcp.json` in the repository root. Do not register this server in a global MCP config unless you explicitly want it available outside this checkout.

```bash
npm ci
npm run mcp:install-browsers
npm run bridge
npm run mcp
```

Project-local MCP clients can launch the server from `.mcp.json`:

```json
{
  "mcpServers": {
    "leaps-image-viewer": {
      "command": "node",
      "args": ["mcp/server.mjs"],
      "env": {
        "LEAPS_VIEWER_URL": "http://127.0.0.1:5173/",
        "LEAPS_BRIDGE_URL": "ws://127.0.0.1:8787"
      }
    }
  }
}
```

For clients that do not read `.mcp.json`, add the same server entry to the client's project/workspace-local MCP configuration, not the user-global configuration.

If the viewer is already running somewhere else, set:

```bash
LEAPS_VIEWER_URL=http://127.0.0.1:5173/ npm run mcp
```

If the bridge is already running somewhere else, set:

```bash
LEAPS_BRIDGE_URL=ws://127.0.0.1:8787 npm run mcp
```

Set `LEAPS_VIEWER_HEADLESS=0` to make the Playwright browser visible while the agent works.
Set `LEAPS_MCP_TRANSPORT=playwright` to bypass the bridge and use the older direct Playwright transport.

## Runtime Modes

- **Bridge mode default**: MCP sends commands to `bridge/server.mjs`, and an open viewer tab handles them. This is the intended agent-tool loop.
- **Fallback mode**: if no viewer tab is connected, MCP opens a headless viewer page so tool calls still work.
- **Playwright transport mode**: set `LEAPS_MCP_TRANSPORT=playwright` when you explicitly want MCP to call the browser page directly.

## Tools

- `viewer_open_sample`: open `chart`, `bayer`, `bad-pixel`, `compare-video`, or `compare-bayer`.
- `viewer_get_state`: return current viewer state.
- `viewer_observe`: return the current stateful session observation: state, visible image rect, selected ROI stats/loss, and recent operation history.
- `viewer_set_view_mode`: set Bayer display mode.
- `viewer_set_brightness`: set brightness as a linear multiplier.
- `viewer_set_white_balance`: set Bayer R/G/B white-balance gains.
- `viewer_get_pixel`: read one image-coordinate pixel.
- `viewer_get_roi_stats`: read ROI statistics.
- `viewer_select_region`: select an image-coordinate ROI.
- `viewer_save_current_region`: persist selected ROI with an optional description.
- `viewer_add_marker`: add an image-coordinate marker.
- `viewer_focus_selected_region`: zoom the selected ROI into view.
- `viewer_screenshot`: return a PNG screenshot.
- `viewer_compare_find_worst_regions`: find high-loss compare ROIs.
- `viewer_compare_get_roi_loss`: compute compare loss for an ROI.

All coordinates are image pixel coordinates: zero-based, top-left origin, `{ x, y, width, height }`, with right/bottom edges exclusive.

The intended agent loop is:

```text
viewer_open_sample
viewer_observe
viewer_set_view_mode / viewer_select_region / viewer_set_white_balance
viewer_observe
viewer_get_pixel / viewer_get_roi_stats / viewer_screenshot
viewer_save_current_region / viewer_add_marker
```

`viewer_observe` is the main stateful checkpoint. It includes a session id and recent operation history so an agent can decide what to do next without losing interaction context.

## Agent Usage Guide

Treat the viewer as a stateful workbench. A good agent should alternate between actions and observations:

```text
act -> observe -> act -> observe -> query -> annotate/save
```

Do not rely only on the first screenshot or first state dump. After every visual manipulation, call `viewer_observe` again so the next decision uses the current view, ROI, stats, and history.

### Minimal Inspection Loop

```json
{ "tool": "viewer_open_sample", "arguments": { "sample": "chart" } }
```

```json
{ "tool": "viewer_observe", "arguments": { "historyLimit": 5 } }
```

```json
{ "tool": "viewer_set_view_mode", "arguments": { "mode": "cfa-false-color" } }
```

```json
{ "tool": "viewer_select_region", "arguments": { "x": 340, "y": 35, "width": 90, "height": 70 } }
```

```json
{ "tool": "viewer_observe", "arguments": { "includeScreenshot": true, "historyLimit": 10 } }
```

```json
{ "tool": "viewer_get_roi_stats", "arguments": { "x": 340, "y": 35, "width": 90, "height": 70 } }
```

```json
{
  "tool": "viewer_save_current_region",
  "arguments": {
    "label": "face-like patch",
    "description": "Synthetic chart portrait ROI selected during agent inspection."
  }
}
```

### Compare Loop

```json
{ "tool": "viewer_open_sample", "arguments": { "sample": "compare-video" } }
```

```json
{ "tool": "viewer_observe", "arguments": {} }
```

```json
{ "tool": "viewer_compare_find_worst_regions", "arguments": { "topK": 5 } }
```

```json
{ "tool": "viewer_select_region", "arguments": { "x": 40, "y": 30, "width": 80, "height": 60 } }
```

```json
{ "tool": "viewer_compare_get_roi_loss", "arguments": { "x": 40, "y": 30, "width": 80, "height": 60 } }
```

### Prompt Template

Use prompts that explicitly ask the agent to observe between actions:

```text
Open the chart sample. Observe the viewer. Switch to CFA false color.
Select the most relevant ROI for the requested inspection. Observe again.
Read ROI stats, add a marker, save the ROI with a description, and summarize the evidence.
```

For Bayer/raw analysis:

```text
Open the Bayer sample. Observe the state and visible image rect.
Use raw-mosaic or CFA false color as needed. Inspect pixels and ROI stats.
Save any ROI you rely on, including a description of why it matters.
```

For compare analysis:

```text
Open the compare-video sample. Observe. Find worst regions.
Select the strongest region, observe again, compute ROI loss, and save it.
Report metric, domain, coordinates, and whether the loss is localized or broad.
```

### What `viewer_observe` Returns

`viewer_observe` returns:

- `session`: session id, viewer URL, and operation count.
- `state`: frame, view mode, Bayer settings, compare settings, selected ROI, markers, saved regions.
- `visibleImageRect`: currently visible image-coordinate rectangle.
- `selectedRegion`: active ROI, if any.
- `selectedRegionStats`: raw/HDR stats for the active image ROI.
- `selectedRegionCompareLoss`: compare loss for the active compare ROI.
- `summary`: short state summary for quick agent decisions.
- `operationHistory`: recent MCP actions and summaries.

Use `includeScreenshot: true` only when the model needs visual inspection. Pixel, ROI, and compare queries are more deterministic and cheaper than screenshot-only reasoning.

## Verify

```bash
npm run mcp:install-browsers
npm run verify:mcp
```

The smoke test starts the MCP server over stdio, opens the synthetic chart sample, observes the session, reads a pixel, reads ROI stats, selects an ROI, adds a marker, and verifies operation history.
