# Agent Operation Guide

This guide describes how a model agent should use LEaps Image Viewer as a stateful tool environment.

The intended runtime path is:

```text
agent -> MCP tools -> WebSocket bridge -> viewer runtime
```

The viewer is not just a display surface. It is a persistent workbench that keeps image state, view mode, viewport, selected ROI, markers, saved regions, compare settings, and recent operation history across tool calls.

## Operating Principles

Use `viewer_observe` as the checkpoint between actions. A good loop is:

```text
open/load -> observe -> manipulate -> observe -> query -> annotate/save -> observe
```

Prefer deterministic data tools before relying on visual screenshots:

- Use `viewer_get_pixel` for single-point inspection.
- Use `viewer_get_roi_stats` for ROI evidence.
- Use `viewer_compare_get_roi_loss` for compare evidence.
- Use `viewer_observe` for state, selected ROI, visible image rect, and operation history.
- Use screenshots only when the model needs visual context or to verify that a manipulation changed the rendered view.

Every ROI must use image pixel coordinates:

- origin is top-left,
- `x` is column,
- `y` is row,
- coordinates are zero-based,
- ROI right/bottom edges are exclusive.

## First Actions

For a sample-driven task:

```json
{ "tool": "viewer_open_sample", "arguments": { "sample": "chart" } }
```

Then immediately observe:

```json
{ "tool": "viewer_observe", "arguments": { "historyLimit": 5 } }
```

For a Bayer/raw task, switch to a useful view before judging:

```json
{ "tool": "viewer_set_view_mode", "arguments": { "mode": "cfa-false-color" } }
```

Then observe again:

```json
{ "tool": "viewer_observe", "arguments": { "includeScreenshot": true, "historyLimit": 10 } }
```

## Inspection Pattern

When asked to inspect a region:

1. Open/load the relevant source.
2. `viewer_observe`.
3. Select a candidate region with `viewer_select_region`.
4. `viewer_observe` again to confirm selected-region context.
5. Query `viewer_get_roi_stats` or `viewer_compare_get_roi_loss`.
6. Add a marker if the result should remain visible.
7. Save the ROI with a description explaining why it matters.

Example:

```json
{ "tool": "viewer_select_region", "arguments": { "x": 340, "y": 35, "width": 90, "height": 70 } }
```

```json
{ "tool": "viewer_focus_selected_region", "arguments": {} }
```

```json
{ "tool": "viewer_zoom", "arguments": { "factor": 1.25, "centerImage": { "x": 385, "y": 68 } } }
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
    "label": "candidate patch",
    "description": "ROI used for the reported stats; selected after observing the CFA false-color view."
  }
}
```

## Bayer/Raw Analysis Pattern

For Bayer frames:

1. Start with `cfa-false-color` to see CFA positions.
2. Use `raw-mosaic` when checking raw brightness patterns.
3. Use `plane-r`, `plane-gr`, `plane-gb`, or `plane-b` when the question is plane-specific.
4. Query ROI stats rather than estimating values from screenshots.
5. When reporting Gr/Gb or per-plane differences, cite the ROI coordinates and the returned per-plane stats.

Useful sequence:

```json
{ "tool": "viewer_set_view_mode", "arguments": { "mode": "raw-mosaic" } }
```

```json
{ "tool": "viewer_observe", "arguments": { "includeScreenshot": true } }
```

```json
{ "tool": "viewer_get_roi_stats", "arguments": { "x": 20, "y": 20, "width": 64, "height": 64 } }
```

## Compare Analysis Pattern

For compare mode:

1. Open compare sample or compare inputs.
2. Observe state and confirm `compare.active`.
3. Run `viewer_compare_find_worst_regions`.
4. Select the strongest or most relevant ROI.
5. Observe selected ROI state.
6. Query `viewer_compare_get_roi_loss`.
7. Save the ROI with metric/domain/time in the description.

Example:

```json
{ "tool": "viewer_open_sample", "arguments": { "sample": "compare-video" } }
```

```json
{ "tool": "viewer_compare_find_worst_regions", "arguments": { "topK": 5 } }
```

```json
{ "tool": "viewer_compare_get_roi_loss", "arguments": { "x": 40, "y": 30, "width": 80, "height": 60 } }
```

When reporting compare results, include:

- GT index,
- target index,
- metric,
- domain,
- frame time if present,
- ROI coordinates,
- whether the loss is localized or broad.

## Screenshot Use

Screenshots are helpful for visual grounding, but they are not the source of truth for raw values.

Use screenshots when:

- choosing between visually distinct regions,
- verifying that a zoom or view-mode change occurred,
- generating a visual explanation for a human.

Avoid screenshot-only reasoning when:

- raw Bayer values matter,
- exact ROI stats are needed,
- compare metrics are available.

MCP image payloads can hit client size limits. Prefer bounded JPEG screenshots unless a task explicitly needs a full-resolution PNG:

```json
{ "tool": "viewer_observe", "arguments": { "includeScreenshot": true, "screenshotMaxWidth": 1600, "screenshotMaxHeight": 1200, "screenshotFormat": "jpeg", "screenshotQuality": 0.85 } }
```

```json
{ "tool": "viewer_screenshot", "arguments": { "maxWidth": 1600, "maxHeight": 1200, "format": "jpeg", "quality": 0.85 } }
```

## Viewport Control Pattern

Viewport tools operate on the active viewer surface. In normal image mode they update `state.viewport`; in compare mode they update `state.compare.view`.

Use `viewer_zoom` for incremental inspection:

```json
{ "tool": "viewer_zoom", "arguments": { "factor": 1.5, "centerImage": { "x": 200, "y": 120 } } }
```

Use `viewer_pan` for screen-pixel movement after zoom:

```json
{ "tool": "viewer_pan", "arguments": { "dx": -120, "dy": 40 } }
```

Use `viewer_fit` when the agent is lost:

```json
{ "tool": "viewer_fit", "arguments": {} }
```

Use `viewer_set_viewport` only when replaying or restoring a known viewport:

```json
{ "tool": "viewer_set_viewport", "arguments": { "scale": 2.4, "offsetX": -180, "offsetY": 24 } }
```

After any viewport change, call `viewer_observe` before drawing conclusions. Report observations in image pixel coordinates, not screen coordinates.

## Recovery Pattern

If a tool result seems inconsistent:

1. Call `viewer_observe` with `historyLimit: 20`.
2. Check `state.mode`, `state.frame`, `state.compare.active`, and `selectedRegion`.
3. Re-select the ROI if needed.
4. Re-run the deterministic query.
5. Save the corrected ROI with a description.

If no viewer is connected to the bridge, the MCP server can open a headless fallback viewer. In either case, keep using `viewer_observe` to understand which session is active.

## Suggested Agent Prompt

```text
Use LEaps Image Viewer as a stateful tool environment.
Always call viewer_observe after opening a source and after each view or ROI manipulation.
Prefer pixel, ROI, and compare metric tools over screenshot-only reasoning.
When you rely on a region, save it with a label and description.
Report coordinates in image pixels and include the metric/domain/time when using compare tools.
```
