# LEaps Image Viewer MCP Server

This repository includes a local MCP server that lets model agents drive the browser viewer through tool calls.

The server launches or reuses the Vite viewer at `http://127.0.0.1:5173/`, opens it in a Playwright browser, and calls the browser-global `window.LEapsViewer` API.

## Run

This project uses a project-local `.mcp.json` in the repository root. Do not register this server in a global MCP config unless you explicitly want it available outside this checkout.

```bash
npm ci
npm run mcp:install-browsers
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
        "LEAPS_VIEWER_URL": "http://127.0.0.1:5173/"
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

Set `LEAPS_VIEWER_HEADLESS=0` to make the Playwright browser visible while the agent works.

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

## Verify

```bash
npm run mcp:install-browsers
npm run verify:mcp
```

The smoke test starts the MCP server over stdio, opens the synthetic chart sample, observes the session, reads a pixel, reads ROI stats, selects an ROI, adds a marker, and verifies operation history.
