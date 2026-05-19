# LEapsImageViewer Agent Guide

## Mission

Build a 2D, agent-friendly image viewer for inspecting Bayer sensor frames. The viewer should make both the rendered image and the underlying CFA sample values easy to query, compare, and annotate.

This project is not a generic gallery and does not need 3D, video, volume rendering, or n-dimensional scientific stack support unless explicitly requested later.

## Primary Use Cases

- Open ordinary 2D images for visual inspection.
- Open Bayer/raw 2D frames and preserve the original sample grid.
- Inspect raw Bayer values by pixel, patch, plane, and ROI.
- Compare RGGB, BGGR, GRBG, and GBRG interpretations.
- Generate deterministic previews, histograms, ROI stats, and overlays that an agent can query.
- Provide stable browser selectors and a stable JavaScript API for automation.
- Provide an MCP server wrapper so model agents can use the viewer through explicit tool calls.

## Coordinate Rules

- Use image pixel coordinates everywhere unless a function name explicitly says screen coordinates.
- Origin is top-left.
- `x` means column, `y` means row.
- Coordinates are zero-based.
- Pixel centers are addressed as integer `{ x, y }`.
- ROI rectangles use `{ x, y, width, height }`, with `x + width` and `y + height` exclusive.
- Never silently rescale raw coordinates after zooming, fitting, rotating, or preview generation.

## Bayer Data Contract

Represent Bayer frames with a binary mosaic plus a sidecar JSON file.

Required metadata fields:

```json
{
  "kind": "bayer-frame",
  "width": 0,
  "height": 0,
  "storageDtype": "uint16",
  "bitDepth": 12,
  "endianness": "little",
  "bayerPattern": "RGGB",
  "blackLevel": 0,
  "whiteLevel": 4095,
  "rowStrideBytes": 0,
  "source": {
    "path": "",
    "type": ""
  }
}
```

Supported `bayerPattern` values are `RGGB`, `BGGR`, `GRBG`, and `GBRG`.

The raw binary file should contain one unsigned 16-bit value per pixel in row-major order. If the active bit depth is lower than 16 bits, keep the values numerically in their active range and document that range with `bitDepth` and `whiteLevel`.

## Viewer Modes

The first viewer should support these 2D modes:

- `demosaic-preview`: RGB preview for human inspection.
- `raw-mosaic`: single-channel Bayer sample grid.
- `cfa-false-color`: raw values tinted by CFA position.
- `plane-r`: R sites only.
- `plane-gr`: green sites on R rows.
- `plane-gb`: green sites on B rows.
- `plane-b`: B sites only.
- `histogram`: full-frame or ROI distribution.

## Source Compare Mode

Comparison is modeled as synchronized 2D source comparison, not as a separate 3D/video-analysis stack.

The comparison tool should support:

- loading 2-4 videos or 2-4 Bayer `.json`/`.raw` pairs,
- using one source as ground truth,
- syncing all videos by timestamp when the sources have a timeline,
- locked pan/zoom/cursor coordinates across every tile,
- a diff tile for `GT -> target`,
- a domain toggle:
  - `Rendered RGB`: compare the displayed RGB frame,
  - `Raw Bayer`: compare Bayer sample values directly when all sources are Bayer frames,
- metrics such as RGB MAE, luma MAE, RGB MSE, edge MAE, RMSE, and PSNR,
- visualization gradients such as heat, signed, and gray,
- ROI loss queries through the agent API.
- manual ROI drag when ROI mode is enabled,
- automatic worst-region search over the current loss map.
- temporal worst-time search over synchronized video sequences.

Loss values must state their frame time, GT index, target index, metric, domain, and coordinate basis. Do not compare gamma-rendered values against linear/raw values without making that conversion explicit.

## Chart Feature Estimation

Chart analysis should tolerate small chart shifts and should report which image regions were used. The checked-in chart sample must be generated in-repo or otherwise clearly redistributable. Current automatic estimates include:

- SNR from low-gradient flat patches.
- Gr/Gb difference from the same flat patches.
- Edge MTF50 from strong horizontal and vertical edge candidates.
- Siemens/star MTF50 from angular contrast around detected star-chart rings.

Star MTF is reported in cycles/pixel. If the measured contrast does not cross 50% before the highest usable ring frequency, mark the value as lower-bounded with `>=`.

## Agent API Shape

Expose a browser-global API for automation:

```ts
window.LEapsViewer = {
  open(input),
  getState(),
  setViewMode(mode),
  setBayerPattern(pattern),
  getBayerPattern(),
  getPixel({ x, y }),
  getPatch({ x, y, width, height, mode }),
  getRoiStats({ x, y, width, height, perPlane }),
  imageToScreen({ x, y }),
  screenToImage({ x, y }),
  zoom({ factor, centerImage, centerScreen }),
  fit(),
  pan({ dx, dy }),
  setViewport({ scale, offsetX, offsetY }),
  addMarker({ x, y, label }),
  selectRegion({ x, y, width, height }),
  screenshot(options)
}
```

MCP agents should use `viewer_observe` as the main checkpoint between actions. The intended loop is:

```text
open -> observe -> manipulate view/ROI/WB -> observe -> query pixels/stats/screenshot -> annotate/save
```

Observations should preserve session id, visible image rect, selected region details, and recent operation history so the agent can work without a human actively watching the viewer.

Every interactive control should also have a stable `data-agent-action` or `data-agent-id` attribute. Prefer explicit actions such as `data-agent-action="set-view-mode:raw-mosaic"` over labels that may change during UI polish.

## Implementation Preferences

- Keep raw Bayer values separate from rendered previews.
- Do not demosaic destructively.
- Keep metadata close to the binary artifact.
- Use typed arrays for raw frame data in the frontend.
- Use Web Workers for heavy stats, histogram, demosaic, and tile preparation.
- Use OpenSeadragon or a similarly stable 2D tile/zoom engine for large images.
- Use deterministic conversions so agent observations are reproducible.

## Related Docs

- `docs/PLUGIN_REGISTRATION.md`: how to define, register, expose, and validate image-analysis plugins for human and agent use.
- `docs/MCP_SERVER.md`: how to run the local MCP server and which viewer tools it exposes.
- `docs/AGENT_OPERATION_GUIDE.md`: how agents should run observe/manipulate/query loops against the viewer.

## Sample Data Layout

Use this layout for local generated samples:

```text
data/
  samples/   original input files
  derived/   generated Bayer raws, metadata, previews, and reports
tools/       reproducible conversion and inspection scripts
```

Generated Bayer samples should include:

- `.raw`: row-major `uint16` Bayer mosaic.
- `.json`: metadata sidecar.
- `.png`: inspection preview when useful.
- Optional stats JSON for quick regression checks.

## Verification

For Bayer conversion scripts, verify at least:

- output width and height match the source image,
- metadata dimensions match the raw file size,
- all sample values are within `[blackLevel, whiteLevel]`,
- CFA site counts match the selected pattern,
- preview artifacts can be opened by common image tools.
