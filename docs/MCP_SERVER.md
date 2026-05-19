# LEaps Image Viewer MCP Server

This repository includes a local MCP server that lets model agents drive the browser viewer through tool calls.

The server launches or reuses the Vite viewer at `http://127.0.0.1:5173/`, opens it in a Playwright browser, and calls the browser-global `window.LEapsViewer` API.

## Run

```bash
npm ci
npm run mcp:install-browsers
npm run mcp
```

MCP clients should launch the server with:

```json
{
  "command": "node",
  "args": ["mcp/server.mjs"],
  "cwd": "C:/Users/leap1/Documents/LEapsImageViewer"
}
```

If the viewer is already running somewhere else, set:

```bash
LEAPS_VIEWER_URL=http://127.0.0.1:5173/ npm run mcp
```

Set `LEAPS_VIEWER_HEADLESS=0` to make the Playwright browser visible while the agent works.

## Tools

- `viewer_open_sample`: open `chart`, `bayer`, `bad-pixel`, `compare-video`, or `compare-bayer`.
- `viewer_get_state`: return current viewer state.
- `viewer_set_view_mode`: set Bayer display mode.
- `viewer_get_pixel`: read one image-coordinate pixel.
- `viewer_get_roi_stats`: read ROI statistics.
- `viewer_select_region`: select an image-coordinate ROI.
- `viewer_save_current_region`: persist selected ROI with an optional description.
- `viewer_focus_selected_region`: zoom the selected ROI into view.
- `viewer_screenshot`: return a PNG screenshot.
- `viewer_compare_find_worst_regions`: find high-loss compare ROIs.
- `viewer_compare_get_roi_loss`: compute compare loss for an ROI.

All coordinates are image pixel coordinates: zero-based, top-left origin, `{ x, y, width, height }`, with right/bottom edges exclusive.

## Verify

```bash
npm run mcp:install-browsers
npm run verify:mcp
```

The smoke test starts the MCP server over stdio, opens the synthetic chart sample, reads a pixel, reads ROI stats, and selects an ROI.
