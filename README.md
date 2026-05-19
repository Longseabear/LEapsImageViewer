# LEaps Image Viewer

Agent-friendly 2D image viewer for HDR, Bayer raw frames, same-position source comparison, and synthetic chart feature estimation.

## What This App Does

- Loads Radiance HDR images and displays tone-mapped previews.
- Loads Bayer `.json` + `.raw` pairs while preserving the original CFA sample grid.
- Supports RGGB, BGGR, GRBG, and GBRG interpretation.
- Shows raw mosaic, RGB CFA false color, demosaic preview, and per-plane views.
- Provides input bit depth, brightness, gamma, and white-balance controls.
- Exposes pixel, patch, ROI, and per-CFA-plane raw statistics for agents.
- Provides a local MCP server so model agents can call viewer tools directly.
- Compares 2-4 videos or Bayer sources at the same image coordinates.
- Includes bad-pixel detection and public-safe synthetic chart analysis demos.
- Estimates chart SNR, Gr/Gb difference, edge MTF, and Siemens/star MTF.

## Requirements

Required for the viewer:

- Node.js 20 or newer
- npm

Optional for regenerating sample assets:

- Python 3.10 or newer
- Python packages: `numpy`, `opencv-python`, `imageio`, `pillow`

The checked-in sample assets are already included, so Python is not required for normal app usage.

## Fresh Setup

Clone the repository:

```bash
git clone https://github.com/Longseabear/LEapsImageViewer.git
cd LEapsImageViewer
```

Install JavaScript dependencies:

```bash
npm ci
```

If you are developing and intentionally updating dependencies, use:

```bash
npm install
```

Start the local dev server:

```bash
npm run dev
```

Open the Vite URL shown in the terminal. By default this project binds to:

```text
http://127.0.0.1:5173/
```

## Basic Workflow

Use the top toolbar:

- `Open`: load an HDR file, or a Bayer `.json` sidecar together with its `.raw` file.
- `Bayer`: load the built-in Bayer sample.
- `BadPx`: load the synthetic bad-pixel Bayer sample.
- `Chart`: load the synthetic Bayer chart sample and run automatic feature estimation.
- `Compare`: load 2-4 videos or Bayer source pairs for synchronized comparison.
- `Find`: run the window-finding agent demo on a Bayer frame.

The right-side panels expose controls, agent trace, chart features, frame metadata, pixel values, and raw statistics.

## Bayer File Format

Bayer inputs are represented as:

- `.json`: metadata sidecar
- `.raw`: row-major `uint16` mosaic

The sidecar must include fields like:

```json
{
  "kind": "bayer-frame",
  "width": 1024,
  "height": 512,
  "storageDtype": "uint16",
  "endianness": "little",
  "bitDepth": 12,
  "blackLevel": 0,
  "whiteLevel": 4095,
  "bayerPattern": "RGGB",
  "artifacts": {
    "raw": "data/derived/example.raw"
  }
}
```

See `AGENTS.md` for the fuller data contract and automation expectations.

## Verification

Run the production build:

```bash
npm run build
```

Verify the included Bayer samples:

```bash
npm run verify:bayer
```

Verify the included HDR sample:

```bash
npm run verify:hdr
```

A healthy checkout should pass all three commands.

## Regenerating Samples

The repository includes generated sample assets under `data/derived/`. You only need these commands if you want to recreate or modify them.

Create the public synthetic chart Bayer sample:

```bash
npm run sample:chart
```

Create the synthetic bad-pixel Bayer sample:

```bash
npm run sample:badpixels
```

Create the video-compare demo pair:

```bash
npm run sample:videos
```

Convert a Radiance HDR image into a Bayer raw sample:

```bash
python tools/make_bayer_from_hdr.py data/samples/aerodynamics_workshop_1k.hdr --out-dir data/derived --pattern RGGB --bit-depth 12
```

On Windows, `py` can be used instead of `python`:

```powershell
py tools/make_bayer_from_hdr.py data/samples/aerodynamics_workshop_1k.hdr --out-dir data/derived --pattern RGGB --bit-depth 12
```

## Agent API

The app exposes a browser-global API:

```js
window.LEapsViewer
```

Useful entry points:

```js
await LEapsViewer.openSampleBayer()
await LEapsViewer.openChartSample()
LEapsViewer.runChartAnalysis()
LEapsViewer.getPixel({ x: 100, y: 80 })
LEapsViewer.getRoiStats({ x: 20, y: 20, width: 64, height: 64 })
LEapsViewer.compare.openSample()
LEapsViewer.compare.findWorstRegions()
```

This is the main contract for browser agents and test automation.

## MCP Server

Run a local MCP server for tool-call based agents:

```bash
npm run mcp:install-browsers
npm run mcp
```

The server exposes tools such as `viewer_open_sample`, `viewer_get_state`, `viewer_get_pixel`, `viewer_get_roi_stats`, `viewer_select_region`, `viewer_save_current_region`, `viewer_screenshot`, and compare-loss helpers.

Smoke test it with:

```bash
npm run verify:mcp
```

See `docs/MCP_SERVER.md` for client configuration and the full tool list.

## Project Layout

```text
src/
  main.js                 app UI, viewer logic, compare mode, chart analysis
  styles.css              app styling
  bayer/                  Bayer parsing and rendering helpers
  hdr/                    Radiance HDR parser
  viewer/                 tone mapping helpers

tools/
  make_bayer_from_hdr.py
  make_bad_pixel_sample.mjs
  make_synthetic_chart_sample.mjs
  make_video_compare_samples.py
  verify_bayer_sample.mjs
  verify_hdr_sample.mjs
  verify_mcp_server.mjs

mcp/
  server.mjs              MCP stdio server for model-agent tool calls

data/
  samples/                source sample files
  derived/                generated Bayer raws, sidecars, previews, and demo videos

docs/
  MCP_SERVER.md           MCP server setup and tool list
  PLUGIN_REGISTRATION.md  plugin authoring guide for humans and agents
```

## Troubleshooting

If `npm run dev` cannot bind to `5173`, another Vite server may already be running. Stop the old process or let Vite choose another port.

If sample-generation scripts fail on Python imports, install the optional packages:

```bash
python -m pip install numpy opencv-python imageio pillow
```

If a Bayer file fails to open, load the `.json` sidecar and its matching `.raw` file together. The sidecar `artifacts.raw` path must match the raw filename or the raw file should be selected in the same file-open action.

If chart MTF values look suspicious, remember that the current estimator is automatic and shift-tolerant, not a full ISO chart calibration. It reports approximate cycles/pixel and marks star MTF as `>=` when the 50% crossing is outside the usable star rings.

## License And Sample Data

Code is released under the MIT License. Checked-in synthetic samples are generated in this repository and dedicated as CC0-1.0 fixtures. The included `aerodynamics_workshop_1k.hdr` sample is from Poly Haven and is CC0; see `THIRD_PARTY_NOTICES.md`.
