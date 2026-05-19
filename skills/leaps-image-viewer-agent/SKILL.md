---
name: leaps-image-viewer-agent
description: Use LEaps Image Viewer as a stateful MCP-driven image inspection workbench for Bayer/raw, ROI, viewport, screenshot, and compare analysis tasks.
---

# LEaps Image Viewer Agent Skill

Use this skill when an agent needs to inspect images through LEaps Image Viewer. The viewer is a stateful workbench, not a one-shot image function.

This skill is intentionally vendor-neutral. It can be copied into Codex, Claude, or any agent system that can read a `SKILL.md` file and call MCP tools.

## Core Rule

Always alternate action and observation:

```text
open/load -> observe -> manipulate -> observe -> query -> annotate/save -> observe
```

Use `viewer_observe` as the checkpoint after every meaningful state change. Do not rely on stale screenshots, stale viewport state, or guessed coordinates.

## Coordinate Contract

- Use image pixel coordinates unless a tool explicitly says screen coordinates.
- Origin is top-left.
- Coordinates are zero-based.
- `x` is column and `y` is row.
- ROI rectangles use `{ x, y, width, height }`.
- Right and bottom edges are exclusive.
- Viewport `dx`, `dy`, `offsetX`, and `offsetY` are screen pixels.

## Startup

If the MCP server is available, first verify the tool list or call a harmless state tool.

Expected important tools:

```text
viewer_open_sample
viewer_get_state
viewer_observe
viewer_set_view_mode
viewer_set_brightness
viewer_set_white_balance
viewer_get_pixel
viewer_get_roi_stats
viewer_select_region
viewer_save_current_region
viewer_add_marker
viewer_focus_selected_region
viewer_zoom
viewer_fit
viewer_pan
viewer_set_viewport
viewer_screenshot
viewer_compare_find_worst_regions
viewer_compare_get_roi_loss
```

If no tools are visible, suspect MCP registration, current working directory, or project-local config issues before assuming the viewer is broken.

## Inspection Loop

For a normal image or chart inspection:

1. Open a source.
2. Observe with `viewer_observe`.
3. Change view mode, brightness, white balance, ROI, or viewport.
4. Observe again.
5. Query pixels, ROI stats, or screenshots.
6. Save useful ROIs with descriptions.

Example:

```json
{ "tool": "viewer_open_sample", "arguments": { "sample": "chart" } }
```

```json
{ "tool": "viewer_observe", "arguments": { "historyLimit": 8 } }
```

```json
{ "tool": "viewer_select_region", "arguments": { "x": 340, "y": 35, "width": 90, "height": 70 } }
```

```json
{ "tool": "viewer_focus_selected_region", "arguments": {} }
```

```json
{ "tool": "viewer_observe", "arguments": { "includeScreenshot": true, "historyLimit": 12 } }
```

```json
{ "tool": "viewer_get_roi_stats", "arguments": { "x": 340, "y": 35, "width": 90, "height": 70 } }
```

```json
{
  "tool": "viewer_save_current_region",
  "arguments": {
    "label": "inspection ROI",
    "description": "ROI used as evidence for the current inspection result."
  }
}
```

## Screenshot Use

Use screenshots for visual grounding only:

- identifying semantic areas,
- checking whether a zoom or view mode change happened,
- explaining what a human would see.

Do not use screenshots as the source of truth for raw Bayer values, exact ROI statistics, or compare loss. Prefer deterministic tools:

```text
viewer_get_pixel
viewer_get_roi_stats
viewer_compare_get_roi_loss
```

When using screenshots, request them through `viewer_observe({ includeScreenshot: true })` when possible so the image is paired with state, viewport, visible image rect, selected ROI, and operation history.

## Viewport Control

Use viewport tools to move around without direct browser UI automation.

```json
{ "tool": "viewer_zoom", "arguments": { "factor": 1.5, "centerImage": { "x": 200, "y": 120 } } }
```

```json
{ "tool": "viewer_pan", "arguments": { "dx": -120, "dy": 40 } }
```

```json
{ "tool": "viewer_fit", "arguments": {} }
```

```json
{ "tool": "viewer_set_viewport", "arguments": { "scale": 2.4, "offsetX": -180, "offsetY": 24 } }
```

After viewport changes, call `viewer_observe` before making a visual judgment.

## Bayer/Raw Analysis

For Bayer frames:

1. Use `cfa-false-color` to understand CFA positions.
2. Use `raw-mosaic` to inspect raw brightness patterns.
3. Use `plane-r`, `plane-gr`, `plane-gb`, or `plane-b` for plane-specific checks.
4. Query ROI stats for evidence.
5. Report Bayer pattern, bit depth, ROI coordinates, and per-plane values.

Useful calls:

```json
{ "tool": "viewer_set_view_mode", "arguments": { "mode": "cfa-false-color" } }
```

```json
{ "tool": "viewer_get_pixel", "arguments": { "x": 120, "y": 80 } }
```

```json
{ "tool": "viewer_get_roi_stats", "arguments": { "x": 96, "y": 64, "width": 64, "height": 64 } }
```

## Compare Analysis

For 2-4 source comparison:

1. Open compare inputs or a compare sample.
2. Observe and confirm `compare.active`.
3. Use `viewer_compare_find_worst_regions`.
4. Select the candidate ROI.
5. Observe again.
6. Query `viewer_compare_get_roi_loss`.
7. Save the ROI with metric/domain/time in the description.

Example:

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
{ "tool": "viewer_compare_get_roi_loss", "arguments": { "x": 40, "y": 30, "width": 80, "height": 60 } }
```

Report compare results with GT index, target index, metric, domain, frame time if present, ROI coordinates, and whether the loss is localized or broad.

## Recovery

If a result seems inconsistent:

1. Call `viewer_observe` with `historyLimit: 20`.
2. Check current source, mode, view mode, viewport, compare state, selected ROI, and recent operations.
3. Use `viewer_fit` if the viewport appears lost.
4. Re-select the ROI if needed.
5. Re-run deterministic queries.
6. Save the corrected ROI with a clear description.

## Response Style

When reporting back to a human:

- State the source and mode used.
- Include ROI coordinates in image pixels.
- Include exact metrics or stats when available.
- Say when a conclusion is screenshot-based rather than value-based.
- Avoid claiming raw values from visual appearance alone.
