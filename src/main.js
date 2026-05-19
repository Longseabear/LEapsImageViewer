import { Bot, Film, FolderOpen, Grid2x2, Layers, Pause, Play, Save, Scan, Trash2, ZoomIn, ZoomOut, createIcons } from "lucide";
import sampleBadPixelMetadataUrl from "../data/derived/aerodynamics_workshop_rggb_12bit_badpixels.json?url";
import sampleBadPixelRawUrl from "../data/derived/aerodynamics_workshop_rggb_12bit_badpixels.raw?url";
import sampleBayerMetadataUrl from "../data/derived/aerodynamics_workshop_rggb_12bit.json?url";
import sampleBayerRawUrl from "../data/derived/aerodynamics_workshop_rggb_12bit.raw?url";
import sampleCompareGtUrl from "../data/derived/video_compare_gt.webm?url";
import sampleCompareShiftedUrl from "../data/derived/video_compare_shifted.webm?url";
import sampleChartMetadataUrl from "../data/derived/synthetic_iq_chart_rggb_12bit.json?url";
import sampleChartRawUrl from "../data/derived/synthetic_iq_chart_rggb_12bit.raw?url";
import sampleHdrUrl from "../data/samples/aerodynamics_workshop_1k.hdr?url";
import {
  BAYER_PATTERNS,
  cfaPlaneAt,
  displayWhiteLevel,
  getPlaneGain,
  normalizeRawValue,
  parseBayerFrame,
} from "./bayer/bayerFrame.js";
import { createBayerImageData } from "./bayer/renderBayer.js";
import { parseRadianceHdr } from "./hdr/rgbe.js";
import { createToneMappedImageData, defaultExposureEv } from "./viewer/toneMap.js";
import "./styles.css";

const VIEW_MODES = [
  ["demosaic-preview", "Demosaic"],
  ["raw-mosaic", "Raw Mosaic"],
  ["cfa-false-color", "RGB CFA"],
  ["plane-r", "R Plane"],
  ["plane-gr", "Gr Plane"],
  ["plane-gb", "Gb Plane"],
  ["plane-b", "B Plane"],
];

const SAVED_REGIONS_STORAGE_KEY = "leaps-image-viewer:saved-regions:v1";

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand" data-agent-id="app-title">
        <span class="brand-mark"></span>
        <span>LEaps Image Viewer</span>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Viewer tools">
        <input id="fileInput" class="visually-hidden" type="file" accept=".hdr,.json,.raw,image/vnd.radiance" multiple />
        <input id="videoInput" class="visually-hidden" type="file" accept="video/*,.json,.raw" multiple />
        <button class="tool-button" type="button" data-agent-action="open-file" aria-label="Open image or Bayer sidecar" title="Open image or Bayer sidecar">
          <i data-lucide="folder-open"></i>
          <span>Open</span>
        </button>
        <button class="tool-button" type="button" data-agent-action="open-sample-bayer" aria-label="Open Bayer sample" title="Open Bayer sample">
          <i data-lucide="grid-2x2"></i>
          <span>Bayer</span>
        </button>
        <button class="tool-button" type="button" data-agent-action="open-bad-pixel-sample" aria-label="Open bad pixel sample" title="Open bad pixel sample">
          <i data-lucide="grid-2x2"></i>
          <span>BadPx</span>
        </button>
        <button class="tool-button" type="button" data-agent-action="open-te42-sample" aria-label="Open synthetic chart Bayer sample" title="Open synthetic chart Bayer sample">
          <i data-lucide="grid-2x2"></i>
          <span>Chart</span>
        </button>
        <button class="tool-button" type="button" data-agent-action="open-video-compare" aria-label="Open sources for comparison" title="Open sources for comparison">
          <i data-lucide="film"></i>
          <span>Compare</span>
        </button>
        <button class="tool-button" type="button" data-agent-action="run-agent-demo" aria-label="Find window" title="Find window">
          <i data-lucide="bot"></i>
          <span>Find</span>
        </button>
        <button class="icon-button" type="button" data-agent-action="zoom-out" aria-label="Zoom out" title="Zoom out">
          <i data-lucide="zoom-out"></i>
        </button>
        <button class="icon-button" type="button" data-agent-action="zoom-in" aria-label="Zoom in" title="Zoom in">
          <i data-lucide="zoom-in"></i>
        </button>
        <button class="tool-button" type="button" data-agent-action="fit-view" aria-label="Fit image" title="Fit image">
          <i data-lucide="scan"></i>
          <span>Fit</span>
        </button>
        <label class="control" data-agent-id="brightness-control">
          <span>Brightness</span>
          <input id="exposureInput" type="range" min="-4" max="6" step="0.05" value="0" data-agent-action="set-brightness" />
          <output id="exposureValue">1.00x</output>
        </label>
        <label class="control compact" data-agent-id="gamma-control">
          <span>Gamma</span>
          <input id="gammaInput" type="number" min="0.4" max="4" step="0.05" value="2.2" data-agent-action="set-gamma" />
        </label>
      </div>
    </header>

    <main class="workspace">
      <section class="viewer-pane" data-agent-id="viewer-pane" aria-label="Image viewport">
        <canvas id="viewerCanvas" data-agent-id="image-canvas"></canvas>
        <div id="statusBadge" class="status-badge" data-agent-id="viewer-status">Loading</div>
      </section>

      <aside class="inspector" data-agent-id="inspector">
        <section class="panel">
          <h2>Controls</h2>
          <div class="form-grid">
            <label class="field" data-agent-id="view-mode-control">
              <span>View</span>
              <select id="viewModeSelect" data-agent-action="set-view-mode">
                ${VIEW_MODES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
              </select>
            </label>
            <label class="field" data-agent-id="input-bit-depth-control">
              <span>Bits</span>
              <input id="bitDepthInput" type="number" min="1" max="16" step="1" value="12" data-agent-action="set-input-bit-depth" />
            </label>
            <label class="field" data-agent-id="bayer-pattern-control">
              <span>Pattern</span>
              <select id="bayerPatternSelect" data-agent-action="set-bayer-pattern">
                ${BAYER_PATTERNS.map((pattern) => `<option value="${pattern}">${pattern}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="wb-grid" data-agent-id="white-balance-controls">
            <label class="field compact-field">
              <span>WB R</span>
              <input id="wbRInput" type="number" min="0" max="8" step="0.05" value="1" data-agent-action="set-white-balance:r" />
            </label>
            <label class="field compact-field">
              <span>WB G</span>
              <input id="wbGInput" type="number" min="0" max="8" step="0.05" value="1" data-agent-action="set-white-balance:g" />
            </label>
            <label class="field compact-field">
              <span>WB B</span>
              <input id="wbBInput" type="number" min="0" max="8" step="0.05" value="1" data-agent-action="set-white-balance:b" />
            </label>
          </div>
        </section>

        <section class="panel">
          <h2>Compare</h2>
          <button class="agent-run-button" type="button" data-agent-action="open-video-compare-panel">
            <i data-lucide="film"></i>
            <span>Load 2-4 Sources</span>
          </button>
          <button class="agent-run-button secondary" type="button" data-agent-action="open-sample-video-compare">
            <i data-lucide="film"></i>
            <span>Demo Pair</span>
          </button>
          <button class="agent-run-button secondary" type="button" data-agent-action="open-sample-bayer-compare">
            <i data-lucide="grid-2x2"></i>
            <span>Bayer Pair</span>
          </button>
          <div class="compare-action-row">
            <button class="agent-run-button compact-action" type="button" data-agent-action="toggle-compare-roi" disabled>
              <i data-lucide="scan"></i>
              <span id="compareRoiModeLabel">ROI Drag</span>
            </button>
            <button class="agent-run-button compact-action secondary" type="button" data-agent-action="hold-compare-overlay" disabled>
              <i data-lucide="layers"></i>
              <span id="compareOverlayLabel">Hold B</span>
            </button>
            <button class="agent-run-button compact-action secondary" type="button" data-agent-action="find-worst-compare-roi" disabled>
              <i data-lucide="bot"></i>
              <span>Worst ROI</span>
            </button>
            <button class="agent-run-button compact-action secondary" type="button" data-agent-action="find-worst-compare-time" disabled>
              <i data-lucide="bot"></i>
              <span>Worst Time</span>
            </button>
          </div>
          <div class="compare-controls" data-agent-id="video-compare-controls">
            <button class="agent-run-button compact-action" type="button" data-agent-action="toggle-video-playback" disabled>
              <i data-lucide="play"></i>
              <span id="comparePlayLabel">Play</span>
            </button>
            <label class="field">
              <span>Time</span>
              <input id="compareTimeInput" type="range" min="0" max="0" step="0.001" value="0" data-agent-action="set-video-time" disabled />
            </label>
            <div class="compare-time-row">
              <output id="compareTimeValue">0.000s</output>
              <output id="compareDurationValue">0.000s</output>
            </div>
            <div class="form-grid compare-grid">
              <label class="field">
                <span>GT</span>
                <select id="compareGtSelect" data-agent-action="set-video-gt" disabled></select>
              </label>
              <label class="field">
                <span>Compare</span>
                <select id="compareTargetSelect" data-agent-action="set-video-target" disabled></select>
              </label>
              <label class="field">
                <span>Domain</span>
                <select id="compareDomainSelect" data-agent-action="set-compare-domain" disabled>
                  <option value="rendered-rgb">Rendered RGB</option>
                  <option value="raw-bayer">Raw Bayer</option>
                </select>
              </label>
              <label class="field">
                <span>Metric</span>
                <select id="compareMetricSelect" data-agent-action="set-video-metric" disabled>
                  <option value="rgb-mae">RGB MAE</option>
                  <option value="luma-mae">Luma MAE</option>
                  <option value="rgb-mse">RGB MSE</option>
                  <option value="edge-mae">Edge MAE</option>
                </select>
              </label>
              <label class="field">
                <span>Gradient</span>
                <select id="compareGradientSelect" data-agent-action="set-video-gradient" disabled>
                  <option value="heat">Heat</option>
                  <option value="signed">Signed</option>
                  <option value="gray">Gray</option>
                </select>
              </label>
            </div>
            <dl class="kv-list compact-kv">
              <div><dt>Sources</dt><dd id="compareVideoCount">-</dd></div>
              <div><dt>MAE</dt><dd id="compareMae">-</dd></div>
              <div><dt>RMSE</dt><dd id="compareRmse">-</dd></div>
              <div><dt>PSNR</dt><dd id="comparePsnr">-</dd></div>
              <div><dt>ROI</dt><dd id="compareRoi">-</dd></div>
              <div><dt>R-MAE</dt><dd id="compareRoiMae">-</dd></div>
              <div><dt>R-PSNR</dt><dd id="compareRoiPsnr">-</dd></div>
              <div><dt>T-Worst</dt><dd id="compareWorstTime">-</dd></div>
            </dl>
          </div>
        </section>

        <section class="panel" data-agent-id="saved-regions-panel">
          <h2>Saved Regions</h2>
          <label class="field saved-region-description">
            <span>Description</span>
            <input id="savedRegionDescriptionInput" type="text" data-agent-action="set-region-description" placeholder="agent note" />
          </label>
          <div class="compare-action-row">
            <button class="agent-run-button compact-action" type="button" data-agent-action="save-current-roi">
              <i data-lucide="save"></i>
              <span>Save ROI</span>
            </button>
            <button class="agent-run-button compact-action secondary" type="button" data-agent-action="clear-saved-regions">
              <i data-lucide="trash-2"></i>
              <span>Clear</span>
            </button>
          </div>
          <dl class="kv-list compact-kv saved-region-summary">
            <div><dt>Saved</dt><dd id="savedRegionCount">0</dd></div>
          </dl>
          <ol id="savedRegionList" class="saved-region-list" data-agent-id="saved-region-list"></ol>
        </section>

        <section class="panel">
          <h2>Agent Trace</h2>
          <button class="agent-run-button" type="button" data-agent-action="run-agent-demo-panel">
            <i data-lucide="bot"></i>
            <span>Find Window</span>
          </button>
          <button class="agent-run-button secondary" type="button" data-agent-action="run-bad-pixel-scan">
            <i data-lucide="bot"></i>
            <span>Find Bad Pixels</span>
          </button>
          <button class="agent-run-button secondary" type="button" data-agent-action="run-te42-analysis">
            <i data-lucide="scan"></i>
            <span>Analyze Chart</span>
          </button>
          <button class="agent-run-button secondary" type="button" data-agent-action="set-te42-face-roi">
            <i data-lucide="scan"></i>
            <span>Face ROI</span>
          </button>
          <ol id="agentLog" class="agent-log" data-agent-id="agent-log">
            <li>Idle. Press Find to scan raw Bayer data for a window-like region.</li>
          </ol>
        </section>

        <section class="panel">
          <h2>Chart Features</h2>
          <dl class="kv-list compact-kv">
            <div><dt>SNR</dt><dd id="te42Snr">-</dd></div>
            <div><dt>Gr-Gb</dt><dd id="te42GreenDiff">-</dd></div>
            <div><dt>MTF Star</dt><dd id="te42MtfStar">-</dd></div>
            <div><dt>MTF H</dt><dd id="te42MtfHorizontal">-</dd></div>
            <div><dt>MTF V</dt><dd id="te42MtfVertical">-</dd></div>
            <div><dt>Flat</dt><dd id="te42FlatCount">-</dd></div>
            <div><dt>Status</dt><dd id="te42Status">-</dd></div>
          </dl>
        </section>

        <section class="panel">
          <h2>Frame</h2>
          <dl class="kv-list">
            <div><dt>Source</dt><dd id="sourceName">-</dd></div>
            <div><dt>Kind</dt><dd id="frameKind">-</dd></div>
            <div><dt>Size</dt><dd id="frameSize">-</dd></div>
            <div><dt>Bits</dt><dd id="frameBits">-</dd></div>
            <div><dt>Pattern</dt><dd id="framePattern">-</dd></div>
            <div><dt>View</dt><dd id="viewState">-</dd></div>
          </dl>
        </section>

        <section class="panel">
          <h2>Pixel</h2>
          <dl class="kv-list">
            <div><dt>XY</dt><dd id="pixelXY">-</dd></div>
            <div><dt>CFA</dt><dd id="pixelCfa">-</dd></div>
            <div><dt>Raw</dt><dd id="pixelRaw">-</dd></div>
            <div><dt>Norm</dt><dd id="pixelNorm">-</dd></div>
            <div><dt>RGB</dt><dd id="pixelRGB">-</dd></div>
            <div><dt>Luma</dt><dd id="pixelLuma">-</dd></div>
          </dl>
        </section>

        <section class="panel">
          <h2>Stats</h2>
          <dl class="kv-list">
            <div><dt>P50</dt><dd id="statP50">-</dd></div>
            <div><dt>P95</dt><dd id="statP95">-</dd></div>
            <div><dt>P99</dt><dd id="statP99">-</dd></div>
            <div><dt>Max</dt><dd id="statMax">-</dd></div>
          </dl>
        </section>
      </aside>
    </main>
  </div>
`;

createIcons({ icons: { Bot, Film, FolderOpen, Grid2x2, Layers, Pause, Play, Save, Scan, Trash2, ZoomIn, ZoomOut } });

const els = {
  canvas: document.querySelector("#viewerCanvas"),
  fileInput: document.querySelector("#fileInput"),
  videoInput: document.querySelector("#videoInput"),
  exposureInput: document.querySelector("#exposureInput"),
  exposureValue: document.querySelector("#exposureValue"),
  gammaInput: document.querySelector("#gammaInput"),
  viewModeSelect: document.querySelector("#viewModeSelect"),
  bitDepthInput: document.querySelector("#bitDepthInput"),
  bayerPatternSelect: document.querySelector("#bayerPatternSelect"),
  wbRInput: document.querySelector("#wbRInput"),
  wbGInput: document.querySelector("#wbGInput"),
  wbBInput: document.querySelector("#wbBInput"),
  agentLog: document.querySelector("#agentLog"),
  statusBadge: document.querySelector("#statusBadge"),
  sourceName: document.querySelector("#sourceName"),
  frameKind: document.querySelector("#frameKind"),
  frameSize: document.querySelector("#frameSize"),
  frameBits: document.querySelector("#frameBits"),
  framePattern: document.querySelector("#framePattern"),
  viewState: document.querySelector("#viewState"),
  pixelXY: document.querySelector("#pixelXY"),
  pixelCfa: document.querySelector("#pixelCfa"),
  pixelRaw: document.querySelector("#pixelRaw"),
  pixelNorm: document.querySelector("#pixelNorm"),
  pixelRGB: document.querySelector("#pixelRGB"),
  pixelLuma: document.querySelector("#pixelLuma"),
  statP50: document.querySelector("#statP50"),
  statP95: document.querySelector("#statP95"),
  statP99: document.querySelector("#statP99"),
  statMax: document.querySelector("#statMax"),
  comparePlayLabel: document.querySelector("#comparePlayLabel"),
  compareTimeInput: document.querySelector("#compareTimeInput"),
  compareTimeValue: document.querySelector("#compareTimeValue"),
  compareDurationValue: document.querySelector("#compareDurationValue"),
  compareGtSelect: document.querySelector("#compareGtSelect"),
  compareTargetSelect: document.querySelector("#compareTargetSelect"),
  compareDomainSelect: document.querySelector("#compareDomainSelect"),
  compareMetricSelect: document.querySelector("#compareMetricSelect"),
  compareGradientSelect: document.querySelector("#compareGradientSelect"),
  compareRoiModeLabel: document.querySelector("#compareRoiModeLabel"),
  compareOverlayLabel: document.querySelector("#compareOverlayLabel"),
  compareVideoCount: document.querySelector("#compareVideoCount"),
  compareMae: document.querySelector("#compareMae"),
  compareRmse: document.querySelector("#compareRmse"),
  comparePsnr: document.querySelector("#comparePsnr"),
  compareRoi: document.querySelector("#compareRoi"),
  compareRoiMae: document.querySelector("#compareRoiMae"),
  compareRoiPsnr: document.querySelector("#compareRoiPsnr"),
  compareWorstTime: document.querySelector("#compareWorstTime"),
  te42Snr: document.querySelector("#te42Snr"),
  te42GreenDiff: document.querySelector("#te42GreenDiff"),
  te42MtfStar: document.querySelector("#te42MtfStar"),
  te42MtfHorizontal: document.querySelector("#te42MtfHorizontal"),
  te42MtfVertical: document.querySelector("#te42MtfVertical"),
  te42FlatCount: document.querySelector("#te42FlatCount"),
  te42Status: document.querySelector("#te42Status"),
  savedRegionDescriptionInput: document.querySelector("#savedRegionDescriptionInput"),
  savedRegionCount: document.querySelector("#savedRegionCount"),
  savedRegionList: document.querySelector("#savedRegionList"),
};

const ctx = els.canvas.getContext("2d", { alpha: false });
const imageCanvas = document.createElement("canvas");
const imageCtx = imageCanvas.getContext("2d", { alpha: false });
const compareDiffCanvas = document.createElement("canvas");
const compareDiffCtx = compareDiffCanvas.getContext("2d", { alpha: false });

const state = {
  frame: null,
  sourceName: "",
  viewMode: "cfa-false-color",
  bayerPattern: "RGGB",
  inputBitDepth: 12,
  wbGains: {
    r: 1,
    g: 1,
    b: 1,
  },
  tone: {
    exposureEv: 0,
    gamma: 1,
    operator: "linear",
  },
  viewport: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  },
  markers: [],
  selection: null,
  savedRegions: loadSavedRegions(),
  candidateRegions: [],
  te42Analysis: null,
  pointer: null,
  drag: null,
  agentDemoRunning: false,
  mode: "image",
  compare: {
    active: false,
    videos: [],
    duration: 0,
    currentTime: 0,
    playing: false,
    gtIndex: 0,
    targetIndex: 1,
    domain: "rendered-rgb",
    metric: "rgb-mae",
    gradient: "heat",
    width: 0,
    height: 0,
    frameCanvases: [],
    frameContexts: [],
    tileRects: [],
    loss: null,
    lossMap: null,
    roiMode: false,
    overlayHold: false,
    worstRegions: [],
    worstTimes: [],
    animationFrame: null,
    view: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
  },
};

const resizeObserver = new ResizeObserver(() => {
  resizeCanvas();
  fitIfNeeded();
  draw();
});
resizeObserver.observe(els.canvas);

document.querySelector('[data-agent-action="open-file"]').addEventListener("click", () => {
  els.fileInput.click();
});

for (const action of ["open-video-compare", "open-video-compare-panel"]) {
  document.querySelector(`[data-agent-action="${action}"]`).addEventListener("click", () => {
    els.videoInput.click();
  });
}

document.querySelector('[data-agent-action="open-sample-bayer"]').addEventListener("click", () => {
  openSampleBayer().catch(handleLoadError);
});

document.querySelector('[data-agent-action="open-bad-pixel-sample"]').addEventListener("click", () => {
  openBadPixelSample().catch(handleLoadError);
});

document.querySelector('[data-agent-action="open-te42-sample"]').addEventListener("click", () => {
  openTe42Sample().catch(handleLoadError);
});

document.querySelector('[data-agent-action="open-sample-video-compare"]').addEventListener("click", () => {
  openSampleVideoCompare().catch(handleLoadError);
});

document.querySelector('[data-agent-action="open-sample-bayer-compare"]').addEventListener("click", () => {
  openSampleBayerCompare().catch(handleLoadError);
});

for (const action of ["run-agent-demo", "run-agent-demo-panel"]) {
  document.querySelector(`[data-agent-action="${action}"]`).addEventListener("click", () => {
    runAgentDemo().catch(handleAgentError);
  });
}

document.querySelector('[data-agent-action="run-bad-pixel-scan"]').addEventListener("click", () => {
  runBadPixelScanDemo().catch(handleAgentError);
});

document.querySelector('[data-agent-action="run-te42-analysis"]').addEventListener("click", () => {
  try {
    runTe42Analysis();
  } catch (error) {
    handleAgentError(error);
  }
});

document.querySelector('[data-agent-action="set-te42-face-roi"]').addEventListener("click", () => {
  setTe42FaceRoi().catch(handleAgentError);
});

document.querySelector('[data-agent-action="zoom-in"]').addEventListener("click", () => {
  zoomAroundCenter(1.25);
});

document.querySelector('[data-agent-action="zoom-out"]').addEventListener("click", () => {
  zoomAroundCenter(0.8);
});

document.querySelector('[data-agent-action="fit-view"]').addEventListener("click", () => {
  fitToCanvas();
  draw();
});

els.fileInput.addEventListener("change", async () => {
  const files = Array.from(els.fileInput.files || []);
  if (files.length) {
    await openFiles(files).catch(handleLoadError);
  }
  els.fileInput.value = "";
});

els.videoInput.addEventListener("change", async () => {
  const files = Array.from(els.videoInput.files || []);
  if (files.length) {
    await openCompareInputs(files).catch(handleLoadError);
  }
  els.videoInput.value = "";
});

els.exposureInput.addEventListener("input", () => {
  state.tone.exposureEv = Number(els.exposureInput.value);
  updateExposureOutput();
  renderCurrentFrame();
  draw();
});

els.gammaInput.addEventListener("input", () => {
  state.tone.gamma = clamp(Number(els.gammaInput.value) || 1, 0.4, 4);
  renderCurrentFrame();
  draw();
});

els.viewModeSelect.addEventListener("change", () => {
  setViewMode(els.viewModeSelect.value);
});

els.bitDepthInput.addEventListener("input", () => {
  setInputBitDepth(els.bitDepthInput.value);
});

els.bayerPatternSelect.addEventListener("change", () => {
  setBayerPattern(els.bayerPatternSelect.value);
});

for (const input of [els.wbRInput, els.wbGInput, els.wbBInput]) {
  input.addEventListener("input", () => {
    setWhiteBalance({
      r: Number(els.wbRInput.value),
      g: Number(els.wbGInput.value),
      b: Number(els.wbBInput.value),
    });
  });
}

document.querySelector('[data-agent-action="toggle-video-playback"]').addEventListener("click", () => {
  if (state.compare.playing) {
    pauseVideoCompare();
  } else {
    playVideoCompare().catch(handleLoadError);
  }
});

els.compareTimeInput.addEventListener("input", () => {
  seekVideoCompare(Number(els.compareTimeInput.value)).catch(handleLoadError);
});

els.compareGtSelect.addEventListener("change", () => {
  setCompareGroundTruth(Number(els.compareGtSelect.value));
});

els.compareTargetSelect.addEventListener("change", () => {
  setCompareTarget(Number(els.compareTargetSelect.value));
});

els.compareDomainSelect.addEventListener("change", () => {
  setCompareDomain(els.compareDomainSelect.value);
});

els.compareMetricSelect.addEventListener("change", () => {
  setCompareMetric(els.compareMetricSelect.value);
});

els.compareGradientSelect.addEventListener("change", () => {
  setCompareGradient(els.compareGradientSelect.value);
});

document.querySelector('[data-agent-action="toggle-compare-roi"]').addEventListener("click", () => {
  setCompareRoiMode(!state.compare.roiMode);
});

const compareOverlayButton = document.querySelector('[data-agent-action="hold-compare-overlay"]');
compareOverlayButton.addEventListener("pointerdown", (event) => {
  if (compareOverlayButton.disabled) return;
  event.preventDefault();
  compareOverlayButton.setPointerCapture?.(event.pointerId);
  setCompareOverlayHold(true);
});
for (const eventName of ["pointerup", "pointercancel", "pointerleave", "blur"]) {
  compareOverlayButton.addEventListener(eventName, () => {
    setCompareOverlayHold(false);
  });
}
compareOverlayButton.addEventListener("keydown", (event) => {
  if (event.code !== "Space" && event.code !== "Enter") return;
  event.preventDefault();
  setCompareOverlayHold(true);
});
compareOverlayButton.addEventListener("keyup", (event) => {
  if (event.code !== "Space" && event.code !== "Enter") return;
  setCompareOverlayHold(false);
});

document.querySelector('[data-agent-action="find-worst-compare-roi"]').addEventListener("click", () => {
  try {
    const regions = findWorstCompareRegions({ topK: 5 });
    appendAgentLog(`Worst ROI scan found ${regions.length} candidates.`);
    if (regions.length) {
      setCompareRoi(regions[0]);
      appendAgentLog(
        `Worst ROI ${regions[0].x},${regions[0].y} ${regions[0].width}x${regions[0].height}, score=${formatFloat(regions[0].score)}.`,
      );
    }
  } catch (error) {
    appendAgentLog(`Worst ROI error: ${error.message}`);
    throw error;
  }
});

document.querySelector('[data-agent-action="find-worst-compare-time"]').addEventListener("click", async () => {
  try {
    const times = await findWorstCompareTimes({ samples: 24, topK: 5 });
    appendAgentLog(`Worst time scan sampled ${times.sampled} frames; found ${times.results.length} candidates.`);
    if (times.results.length) {
      const best = times.results[0];
      appendAgentLog(
        `Worst time ${formatSeconds(best.time)}s, MAE=${formatFloat(best.mae)}, PSNR=${formatPsnr(best.psnr)}.`,
      );
    }
  } catch (error) {
    appendAgentLog(`Worst time error: ${error.message}`);
    throw error;
  }
});

document.querySelector('[data-agent-action="save-current-roi"]').addEventListener("click", () => {
  try {
    const saved = saveCurrentRegion({
      description: els.savedRegionDescriptionInput.value,
    });
    els.savedRegionDescriptionInput.value = "";
    appendAgentLog(`Saved ${saved.mode} ROI ${saved.region.x},${saved.region.y} ${saved.region.width}x${saved.region.height}.`);
  } catch (error) {
    handleAgentError(error);
  }
});

document.querySelector('[data-agent-action="clear-saved-regions"]').addEventListener("click", () => {
  clearSavedRegions();
  appendAgentLog("Cleared saved regions.");
});

els.savedRegionList.addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("button[data-saved-region-id]")
    : null;
  if (!button) return;
  const id = button.dataset.savedRegionId;
  if (button.dataset.savedAction === "delete") {
    deleteSavedRegion(id);
    return;
  }
  focusSavedRegion(id).catch(handleAgentError);
});

els.canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  els.canvas.setPointerCapture(event.pointerId);
  const point = eventToCanvasPoint(event);
  if (state.compare.active && state.compare.roiMode) {
    const start = compareScreenToImage(point);
    state.drag = {
      pointerId: event.pointerId,
      mode: "compare-roi",
      startImageX: start.x,
      startImageY: start.y,
    };
    state.selection = normalizeCompareRoi({ x: start.x, y: start.y, width: 1, height: 1 });
    updateCompareInspector();
    draw();
    return;
  }

  const activeView = state.compare.active ? state.compare.view : state.viewport;
  state.drag = {
    pointerId: event.pointerId,
    mode: state.compare.active ? "compare" : "image",
    startX: point.x,
    startY: point.y,
    offsetX: activeView.offsetX,
    offsetY: activeView.offsetY,
  };
});

els.canvas.addEventListener("pointermove", (event) => {
  const point = eventToCanvasPoint(event);
  if (state.drag?.pointerId === event.pointerId) {
    if (state.drag.mode === "compare-roi") {
      const current = compareScreenToImage(point);
      state.selection = normalizeCompareRoiFromCorners(
        state.drag.startImageX,
        state.drag.startImageY,
        current.x,
        current.y,
      );
      updateCompareInspector();
      draw();
      updatePointer(point);
      return;
    }
    const activeView = state.drag.mode === "compare" ? state.compare.view : state.viewport;
    activeView.offsetX = state.drag.offsetX + point.x - state.drag.startX;
    activeView.offsetY = state.drag.offsetY + point.y - state.drag.startY;
    updateViewState();
    draw();
  }
  updatePointer(point);
});

els.canvas.addEventListener("pointerup", (event) => {
  if (state.drag?.pointerId === event.pointerId) {
    if (state.drag.mode === "compare-roi") {
      updateCompareInspector();
    }
    state.drag = null;
  }
});

els.canvas.addEventListener("pointerleave", () => {
  state.pointer = null;
  updatePixelInspector(null);
  draw();
});

els.canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  zoomSelectionFromContextMenu(event).catch(handleAgentError);
});

els.canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.001);
    zoomAt(eventToCanvasPoint(event), factor);
  },
  { passive: false },
);

window.LEapsViewer = {
  open(input, options = {}) {
    if (Array.isArray(input) && input.length >= 2) {
      return openCompareInputs(input);
    }
    if (input instanceof File && input.type.startsWith("video/")) {
      return openVideoCompare([input]);
    }
    if (typeof input === "string" && input.toLowerCase().endsWith(".json")) {
      return openBayer({ metadataUrl: input, rawUrl: options.rawUrl });
    }
    if (input instanceof File && input.name.toLowerCase().endsWith(".json")) {
      return openBayer({ metadataFile: input, rawFile: options.rawFile });
    }
    if (input?.metadata && input?.rawBuffer) {
      return openBayer(input);
    }
    return openHdr(input);
  },
  openHdr,
  openBayer,
  openSampleBayer,
  openBadPixelSample,
  openChartSample: openTe42Sample,
  openTe42Sample,
  openCompareInputs,
  openBayerCompare,
  openSampleBayerCompare,
  openVideoCompare,
  openSampleVideoCompare,
  runAgentDemo,
  runBadPixelScanDemo,
  runChartAnalysis: runTe42Analysis,
  runTe42Analysis,
  setChartFaceRoi: setTe42FaceRoi,
  setTe42FaceRoi,
  estimateChartFeatures: estimateTe42Features,
  estimateTe42Features,
  findBadPixels,
  observe: observeViewer,
  getState,
  setViewMode,
  setInputBitDepth,
  setBrightness,
  setBrightnessEv,
  setWhiteBalance,
  setBayerPattern,
  getBayerPattern() {
    return state.bayerPattern;
  },
  getPixel,
  getPatch,
  getRoiStats,
  imageToScreen,
  screenToImage,
  compare: {
    open: openCompareInputs,
    openSample: openSampleVideoCompare,
    openBayer: openBayerCompare,
    openSampleBayer: openSampleBayerCompare,
    play: playVideoCompare,
    pause: pauseVideoCompare,
    setTime: seekVideoCompare,
    setGroundTruth: setCompareGroundTruth,
    setTarget: setCompareTarget,
    setDomain: setCompareDomain,
    setMetric: setCompareMetric,
    setGradient: setCompareGradient,
    setOverlayHold: setCompareOverlayHold,
    setRoiMode: setCompareRoiMode,
    setRoi: setCompareRoi,
    getRoiLoss: getCompareRoiLoss,
    findWorstRegions: findWorstCompareRegions,
    findWorstTimes: findWorstCompareTimes,
    getState: getCompareState,
    getPixelCompare,
    getFrameLoss: () => state.compare.loss,
  },
  addMarker(marker) {
    const next = { x: Number(marker.x), y: Number(marker.y), label: marker.label || "" };
    state.markers.push(next);
    draw();
    return next;
  },
  selectRegion(region) {
    state.selection = state.compare.active ? normalizeCompareRoi(region) : normalizeRoi(region);
    updateRegionInspectors();
    draw();
    return state.selection;
  },
  focusSelectedRegion,
  saveRegion,
  saveCurrentRegion,
  getSavedRegions,
  deleteSavedRegion,
  clearSavedRegions,
  focusSavedRegion,
  screenshot(options = {}) {
    if (options.source === "tone-mapped-image" || options.source === "rendered-image") {
      return imageCanvas.toDataURL("image/png");
    }
    return els.canvas.toDataURL("image/png");
  },
};

syncCompareControls();
syncSavedRegionList();
connectViewerBridge();
openSampleBayer().catch(handleLoadError);

async function openFiles(files) {
  const videoFiles = files.filter((file) => file.type.startsWith("video/"));
  if (videoFiles.length) {
    return openVideoCompare(videoFiles);
  }

  const bayerCompareInputs = await collectBayerInputsFromFiles(files);
  if (bayerCompareInputs.length >= 2) {
    return openBayerCompare(bayerCompareInputs);
  }

  const hdrFile = files.find((file) => file.name.toLowerCase().endsWith(".hdr"));
  if (hdrFile) {
    return openHdr(hdrFile);
  }

  if (bayerCompareInputs.length === 1) {
    return openBayer(bayerCompareInputs[0]);
  }

  throw new Error("Open a .hdr file, or select Bayer .json/.raw sources.");
}

async function openSampleBayer() {
  return openBayer({
    metadataUrl: sampleBayerMetadataUrl,
    rawUrl: sampleBayerRawUrl,
    name: "aerodynamics_workshop_rggb_12bit.json",
  });
}

async function openBadPixelSample() {
  return openBayer({
    metadataUrl: sampleBadPixelMetadataUrl,
    rawUrl: sampleBadPixelRawUrl,
    name: "aerodynamics_workshop_rggb_12bit_badpixels.json",
  });
}

async function openTe42Sample() {
  return openBayer({
    metadataUrl: sampleChartMetadataUrl,
    rawUrl: sampleChartRawUrl,
    name: "synthetic_iq_chart_rggb_12bit.json",
  });
}

async function openSampleBayerCompare() {
  return openBayerCompare([
    {
      metadataUrl: sampleBayerMetadataUrl,
      rawUrl: sampleBayerRawUrl,
      name: "aerodynamics_workshop_rggb_12bit.json",
    },
    {
      metadataUrl: sampleBadPixelMetadataUrl,
      rawUrl: sampleBadPixelRawUrl,
      name: "aerodynamics_workshop_rggb_12bit_badpixels.json",
    },
  ]);
}

async function openSampleVideoCompare() {
  return openVideoCompare([sampleCompareGtUrl, sampleCompareShiftedUrl]);
}

async function openHdr(input = sampleHdrUrl) {
  setStatus("Loading");
  deactivateVideoCompare();
  const { buffer, name } = await readBinaryInput(input);
  const frame = parseRadianceHdr(buffer);

  state.mode = "image";
  state.frame = frame;
  state.sourceName = name;
  state.viewMode = "demosaic-preview";
  state.inputBitDepth = 16;
  state.tone.exposureEv = defaultExposureEv(frame.stats);
  state.tone.gamma = 2.2;
  state.tone.operator = "reinhard";
  state.markers = [];
  state.selection = null;
  state.candidateRegions = [];
  state.te42Analysis = null;

  syncControls();
  renderCurrentFrame();
  fitToCanvas();
  updateFrameInspector();
  updateTe42AnalysisInspector();
  setStatus("Ready");
  draw();
  return getState();
}

async function openBayer(input) {
  setStatus("Loading");
  deactivateVideoCompare();
  const { metadata, rawBuffer, name } = await readBayerInput(input);
  const frame = parseBayerFrame(metadata, rawBuffer);

  state.mode = "image";
  state.frame = frame;
  state.sourceName = name;
  state.viewMode = "cfa-false-color";
  state.bayerPattern = frame.bayerPattern;
  state.inputBitDepth = frame.bitDepth;
  state.tone.exposureEv = 0;
  state.tone.gamma = 1;
  state.tone.operator = "linear";
  state.markers = [];
  state.selection = null;
  state.candidateRegions = [];
  state.te42Analysis = null;

  syncControls();
  renderCurrentFrame();
  fitToCanvas();
  updateFrameInspector();
  updateTe42AnalysisInspector();
  setStatus("Ready");
  if (isTe42SourceName(name)) {
    runTe42Analysis({ auto: true });
    return getState();
  }
  draw();
  return getState();
}

async function openCompareInputs(inputs) {
  const list = Array.from(inputs || []);
  const videoSources = list.filter(isVideoLikeInput);
  if (videoSources.length) {
    return openVideoCompare(videoSources);
  }

  const bayerInputs = list.some((input) => input instanceof File)
    ? await collectBayerInputsFromFiles(list)
    : list.filter(isBayerLikeCompareInput);
  if (bayerInputs.length >= 2) {
    return openBayerCompare(bayerInputs);
  }

  throw new Error("Load 2-4 video files or 2-4 Bayer .json/.raw pairs for comparison.");
}

async function openBayerCompare(inputs) {
  let sources = Array.from(inputs || []);
  if (sources.some((input) => input instanceof File)) {
    sources = await collectBayerInputsFromFiles(sources);
  }
  sources = sources.filter(isBayerLikeCompareInput).slice(0, 4);
  if (sources.length < 2) {
    throw new Error("Load 2-4 Bayer .json/.raw pairs for comparison.");
  }

  setStatus("Loading");
  deactivateVideoCompare();

  const tracks = await Promise.all(sources.map(createBayerTrack));
  await activateCompareTracks(tracks, {
    domain: "raw-bayer",
    logLines: [
      `Loaded ${tracks.length} Bayer sources for same-position comparison.`,
      "Domain=Raw Bayer compares sensor values directly; toggle to Rendered RGB for visual output comparison.",
      "Use ROI, Worst ROI, and the same cursor/zoom across every tile.",
    ],
  });
  return getCompareState();
}

async function openVideoCompare(inputs) {
  const sources = Array.from(inputs || []).filter(isVideoLikeInput).slice(0, 4);
  if (sources.length < 2) {
    throw new Error("Load 2-4 video files for comparison.");
  }

  setStatus("Loading");
  deactivateVideoCompare();

  const videos = await Promise.all(sources.map(createVideoTrack));
  try {
    await activateCompareTracks(videos, {
      domain: "rendered-rgb",
      logLines: [
        `Loaded ${videos.length} videos for synced comparison.`,
        `GT=A, target=${compareLabel(Math.min(1, videos.length - 1))}, metric=${state.compare.metric}, gradient=${state.compare.gradient}.`,
        "Use the same cursor, zoom, ROI, and timestamp across all video tiles.",
      ],
    });
  } catch (error) {
    cleanupCompareTracks(videos);
    throw error;
  }
  return getCompareState();
}

async function activateCompareTracks(tracks, options = {}) {
  const width = Math.min(...tracks.map(compareTrackWidth));
  const height = Math.min(...tracks.map(compareTrackHeight));
  const duration = compareTracksHaveTimeline(tracks)
    ? Math.min(...tracks.map(compareTrackDuration).filter((value) => value > 0))
    : 0;

  if (!width || !height) {
    throw new Error("Could not read source dimensions.");
  }
  if (compareTracksHaveTimeline(tracks) && !duration) {
    throw new Error("Could not read video duration.");
  }

  state.mode = "compare";
  state.frame = null;
  state.sourceName = tracks.map((track) => track.name).join(" | ");
  state.compare.active = true;
  state.compare.videos = tracks;
  state.compare.duration = duration;
  state.compare.currentTime = 0;
  state.compare.playing = false;
  state.compare.gtIndex = 0;
  state.compare.targetIndex = Math.min(1, tracks.length - 1);
  state.compare.domain = sanitizeCompareDomain(options.domain || "rendered-rgb", tracks);
  state.compare.width = width;
  state.compare.height = height;
  state.compare.loss = null;
  state.compare.lossMap = null;
  state.compare.roiMode = false;
  state.compare.overlayHold = false;
  state.compare.worstRegions = [];
  state.compare.worstTimes = [];
  state.selection = null;
  state.markers = [];
  state.candidateRegions = [];
  state.te42Analysis = null;
  state.compare.frameCanvases = tracks.map(() => document.createElement("canvas"));
  state.compare.frameContexts = state.compare.frameCanvases.map((canvas) => {
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext("2d", { alpha: false });
  });
  compareDiffCanvas.width = width;
  compareDiffCanvas.height = height;

  await seekVideosTo(0);

  syncCompareControls();
  updateCompareInspector();
  updateTe42AnalysisInspector();
  fitToCanvas();
  updateCompareFramesAndLoss();
  setAgentLog(options.logLines || [
    `Loaded ${tracks.length} sources for comparison.`,
    `Domain=${state.compare.domain}, target=${compareLabel(state.compare.targetIndex)}.`,
  ]);
  setStatus("Ready");
  draw();
}

function deactivateVideoCompare() {
  if (!state.compare.active && !state.compare.videos.length) return;
  pauseVideoCompare();
  cleanupCompareTracks(state.compare.videos);
  state.compare.active = false;
  state.compare.videos = [];
  state.compare.frameCanvases = [];
  state.compare.frameContexts = [];
  state.compare.tileRects = [];
  state.compare.loss = null;
  state.compare.lossMap = null;
  state.compare.domain = "rendered-rgb";
  state.compare.roiMode = false;
  state.compare.overlayHold = false;
  state.compare.worstRegions = [];
  state.compare.worstTimes = [];
  syncCompareControls();
}

function cleanupCompareTracks(tracks) {
  for (const track of tracks || []) {
    if (track.video) {
      track.video.pause();
      track.video.removeAttribute("src");
      track.video.load();
    }
    if (track.url && track.revokeUrl) {
      URL.revokeObjectURL(track.url);
    }
  }
}

function isVideoLikeInput(input) {
  return (
    input instanceof File && input.type.startsWith("video/")
  ) || (
    input instanceof Blob && input.type.startsWith("video/")
  ) || (
    typeof input === "string" && /\.(mp4|m4v|mov|webm|ogg)$/i.test(input)
  );
}

function isBayerLikeCompareInput(input) {
  return Boolean(
    input?.metadata ||
      input?.metadataFile ||
      input?.metadataUrl ||
      (typeof input === "string" && input.toLowerCase().endsWith(".json")),
  );
}

async function collectBayerInputsFromFiles(files) {
  const list = Array.from(files || []);
  const metadataFiles = list.filter((file) => file.name?.toLowerCase().endsWith(".json"));
  const rawFiles = list.filter((file) => file.name?.toLowerCase().endsWith(".raw"));
  const inputs = [];

  for (const metadataFile of metadataFiles) {
    const metadata = JSON.parse(await metadataFile.text());
    const rawFile = findRawFileForMetadata(metadataFile, metadata, rawFiles);
    if (!rawFile) continue;
    inputs.push({ metadataFile, rawFile });
  }

  return inputs;
}

async function createVideoTrack(input, index) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";

  let url;
  let name;
  if (typeof input === "string") {
    url = input;
    name = input.split(/[\\/]/).pop() || `Video ${compareLabel(index)}`;
  } else {
    url = URL.createObjectURL(input);
    name = input.name || `Video ${compareLabel(index)}`;
  }

  video.src = url;
  video.load();
  await waitForVideoMetadata(video);
  return {
    kind: "video",
    video,
    url,
    revokeUrl: typeof input !== "string",
    name,
    width: video.videoWidth,
    height: video.videoHeight,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
  };
}

async function createBayerTrack(input, index) {
  const normalizedInput = typeof input === "string" ? { metadataUrl: input } : input;
  const { metadata, rawBuffer, name } = await readBayerInput(normalizedInput);
  const frame = parseBayerFrame(metadata, rawBuffer);
  return {
    kind: "bayer-frame",
    frame,
    name: name || `Bayer ${compareLabel(index)}`,
    width: frame.width,
    height: frame.height,
    duration: 0,
    rawCanvas: createBayerTrackCanvas(frame, "cfa-false-color"),
    renderedCanvas: createBayerTrackCanvas(frame, "demosaic-preview"),
  };
}

function createBayerTrackCanvas(frame, viewMode) {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  canvas.getContext("2d", { alpha: false }).putImageData(
    createBayerImageData(frame, {
      viewMode,
      bayerPattern: frame.bayerPattern,
      inputBitDepth: frame.bitDepth,
      wbGains: { r: 1, g: 1, gr: 1, gb: 1, b: 1 },
      tone: { exposureEv: 0, gamma: 1, operator: "linear" },
    }),
    0,
    0,
  );
  return canvas;
}

function compareTrackWidth(track) {
  return track.width || track.video?.videoWidth || track.frame?.width || 0;
}

function compareTrackHeight(track) {
  return track.height || track.video?.videoHeight || track.frame?.height || 0;
}

function compareTrackDuration(track) {
  if (track.kind !== "video") return 0;
  return Number.isFinite(track.duration) ? track.duration : Number.isFinite(track.video?.duration) ? track.video.duration : 0;
}

function compareTracksHaveTimeline(tracks = state.compare.videos) {
  return tracks.length > 0 && tracks.every((track) => track.kind === "video");
}

function compareSupportsRawBayer(tracks = state.compare.videos) {
  return tracks.length >= 2 && tracks.every((track) => track.kind === "bayer-frame");
}

function sanitizeCompareDomain(domain, tracks = state.compare.videos) {
  if (domain === "raw-bayer" && compareSupportsRawBayer(tracks)) return "raw-bayer";
  return "rendered-rgb";
}

function compareTrackDrawable(track) {
  if (track.kind === "bayer-frame") {
    return state.compare.domain === "raw-bayer" ? track.rawCanvas : track.renderedCanvas;
  }
  return track.video;
}

function waitForVideoMetadata(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not load video metadata."));
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function waitForVideoSeeks(videos) {
  return Promise.all(videos.map(waitForVideoSeek));
}

function waitForVideoSeek(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 1200);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not seek video."));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("loadeddata", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function seekVideoCompare(time) {
  if (!state.compare.active) return getCompareState();
  pauseVideoCompare();
  await seekVideosTo(time);
  syncCompareTimeControls();
  updateCompareFramesAndLoss();
  draw();
  return getCompareState();
}

function seekVideosTo(time) {
  const targetTime = clampFinite(time, 0, state.compare.duration);
  state.compare.currentTime = targetTime;
  if (!compareTracksHaveTimeline()) return Promise.resolve([]);
  return Promise.all(
    state.compare.videos.map((track) => (
      track.video ? seekSingleVideo(track.video, targetTime) : Promise.resolve()
    )),
  );
}

function seekSingleVideo(video, time) {
  const delta = Math.abs(video.currentTime - time);
  if (delta < 0.001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 1500);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not seek video."));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

async function playVideoCompare() {
  if (!state.compare.active || state.compare.playing || !compareTracksHaveTimeline()) return getCompareState();
  if (state.compare.currentTime >= state.compare.duration - 0.02) {
    await seekVideoCompare(0);
  }
  for (const track of state.compare.videos) {
    if (track.video) track.video.currentTime = state.compare.currentTime;
  }
  await Promise.all(state.compare.videos.map((track) => track.video?.play?.()).filter(Boolean));
  state.compare.playing = true;
  syncCompareControls();
  runCompareAnimationLoop();
  return getCompareState();
}

function pauseVideoCompare() {
  if (state.compare.animationFrame) {
    window.cancelAnimationFrame(state.compare.animationFrame);
    state.compare.animationFrame = null;
  }
  for (const track of state.compare.videos) {
    track.video?.pause?.();
  }
  state.compare.playing = false;
  syncCompareControls();
}

function runCompareAnimationLoop() {
  if (!state.compare.playing) return;
  const primary = state.compare.videos.find((track) => track.video)?.video;
  if (!primary) return;
  state.compare.currentTime = clamp(primary.currentTime, 0, state.compare.duration);
  if (state.compare.currentTime >= state.compare.duration - 0.01) {
    pauseVideoCompare();
    return;
  }
  for (const track of state.compare.videos.slice(1)) {
    if (track.video && Math.abs(track.video.currentTime - state.compare.currentTime) > 0.08) {
      track.video.currentTime = state.compare.currentTime;
    }
  }
  syncCompareTimeControls();
  updateCompareFramesAndLoss();
  draw();
  state.compare.animationFrame = window.requestAnimationFrame(runCompareAnimationLoop);
}

function setCompareGroundTruth(index) {
  if (!state.compare.active) return getCompareState();
  state.compare.gtIndex = clamp(Math.floor(index), 0, state.compare.videos.length - 1);
  if (state.compare.targetIndex === state.compare.gtIndex) {
    state.compare.targetIndex = firstNonGtCompareIndex();
  }
  syncCompareControls();
  updateCompareFramesAndLoss();
  draw();
  return getCompareState();
}

function setCompareTarget(index) {
  if (!state.compare.active) return getCompareState();
  state.compare.targetIndex = clamp(Math.floor(index), 0, state.compare.videos.length - 1);
  if (state.compare.targetIndex === state.compare.gtIndex) {
    state.compare.targetIndex = firstNonGtCompareIndex();
  }
  syncCompareControls();
  updateCompareFramesAndLoss();
  draw();
  return getCompareState();
}

function setCompareDomain(domain) {
  if (!state.compare.active) return getCompareState();
  state.compare.domain = sanitizeCompareDomain(domain);
  state.compare.loss = null;
  state.compare.lossMap = null;
  state.compare.worstRegions = [];
  state.compare.worstTimes = [];
  syncCompareControls();
  updateCompareFramesAndLoss();
  draw();
  return getCompareState();
}

function setCompareMetric(metric) {
  state.compare.metric = metric;
  syncCompareControls();
  updateCompareFramesAndLoss();
  draw();
  return getCompareState();
}

function setCompareGradient(gradient) {
  state.compare.gradient = gradient;
  syncCompareControls();
  updateCompareFramesAndLoss();
  draw();
  return getCompareState();
}

function setCompareOverlayHold(enabled) {
  state.compare.overlayHold = Boolean(enabled) && state.compare.active;
  syncCompareControls();
  draw();
  return state.compare.overlayHold;
}

function setCompareRoiMode(enabled) {
  state.compare.roiMode = Boolean(enabled) && state.compare.active;
  syncCompareControls();
  draw();
  return state.compare.roiMode;
}

function setCompareRoi(region) {
  if (!state.compare.active) return null;
  state.selection = normalizeCompareRoi(region);
  updateRegionInspectors();
  draw();
  return state.selection;
}

function getCompareRoiLoss(region = state.selection) {
  if (!state.compare.active || !region) return null;
  updateCompareFramesAndLoss();
  return getCompareRoiLossNoRefresh(region);
}

function getCompareRoiLossNoRefresh(region = state.selection) {
  if (!state.compare.active || !region) return null;
  const roi = normalizeCompareRoi(region);
  if (!roi.width || !roi.height) return { ...roi, count: 0 };

  const mapped = computeLossMapRoiLoss(roi);
  if (mapped) {
    return {
      ...roi,
      ...mapped,
      gtIndex: state.compare.gtIndex,
      targetIndex: state.compare.targetIndex,
      domain: state.compare.domain,
      metric: state.compare.metric,
      time: state.compare.currentTime,
    };
  }

  const gtCtx = state.compare.frameContexts[state.compare.gtIndex];
  const targetCtx = state.compare.frameContexts[state.compare.targetIndex];
  const gt = gtCtx.getImageData(roi.x, roi.y, roi.width, roi.height);
  const target = targetCtx.getImageData(roi.x, roi.y, roi.width, roi.height);
  const loss = computeImageDataLoss(gt.data, target.data, roi.width * roi.height, state.compare.metric);
  return {
    ...roi,
    ...loss,
    gtIndex: state.compare.gtIndex,
    targetIndex: state.compare.targetIndex,
    domain: state.compare.domain,
    metric: state.compare.metric,
    time: state.compare.currentTime,
  };
}

function computeLossMapRoiLoss(roi) {
  const lossMap = state.compare.lossMap;
  if (!lossMap) return null;
  let maeSum = 0;
  let mseSum = 0;
  let maxValue = 0;
  let count = 0;

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    const row = y * state.compare.width;
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const value = lossMap[row + x];
      maeSum += value;
      mseSum += value * value;
      maxValue = Math.max(maxValue, value);
      count += 1;
    }
  }

  const mae = count ? maeSum / count : 0;
  const mse = count ? mseSum / count : 0;
  const rmse = Math.sqrt(mse);
  const psnr = rmse > 0 ? 20 * Math.log10(1 / rmse) : Number.POSITIVE_INFINITY;
  return { count, mae, mse, rmse, psnr, max: maxValue };
}

function findWorstCompareRegions(options = {}) {
  if (!state.compare.active) return [];
  updateCompareFramesAndLoss();
  const lossMap = state.compare.lossMap;
  if (!lossMap) return [];

  const width = state.compare.width;
  const height = state.compare.height;
  const roiWidth = clamp(
    Math.floor(Number(options.width) || Math.round(width * 0.16)),
    8,
    width,
  );
  const roiHeight = clamp(
    Math.floor(Number(options.height) || Math.round(height * 0.22)),
    8,
    height,
  );
  const step = clamp(Math.floor(Number(options.step) || Math.round(Math.min(roiWidth, roiHeight) / 2)), 1, 128);
  const topK = clamp(Math.floor(Number(options.topK) || 5), 1, 20);
  const integral = buildIntegralImage(lossMap, width, height);
  const candidates = [];

  for (let y = 0; y <= height - roiHeight; y += step) {
    for (let x = 0; x <= width - roiWidth; x += step) {
      const score = rectAverage(integral, width, x, y, roiWidth, roiHeight);
      candidates.push({ x, y, width: roiWidth, height: roiHeight, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => roiIou(existing, candidate) > 0.35)) continue;
    selected.push(candidate);
    if (selected.length >= topK) break;
  }

  state.compare.worstRegions = selected;
  draw();
  return selected;
}

async function findWorstCompareTimes(options = {}) {
  if (!state.compare.active) return { sampled: 0, results: [] };
  if (!compareTracksHaveTimeline()) return { sampled: 0, results: [] };
  pauseVideoCompare();
  const sampleCount = clamp(Math.floor(Number(options.samples) || 24), 2, 240);
  const topK = clamp(Math.floor(Number(options.topK) || 5), 1, 20);
  const duration = state.compare.duration;
  const end = Math.max(0, duration - 0.001);
  const originalTime = state.compare.currentTime;
  const results = [];

  setStatus("Scanning");

  for (let index = 0; index < sampleCount; index += 1) {
    const time = sampleCount === 1 ? 0 : (end * index) / (sampleCount - 1);
    await seekVideosTo(time);
    const loss = updateCompareFramesAndLoss();
    if (!loss) continue;
    results.push({
      time,
      mae: loss.mae,
      mse: loss.mse,
      rmse: loss.rmse,
      psnr: loss.psnr,
      max: loss.max,
      metric: loss.metric,
    });
  }

  results.sort((a, b) => b.mae - a.mae);
  const selected = results.slice(0, topK);
  state.compare.worstTimes = selected;

  if (selected.length) {
    await seekVideosTo(selected[0].time);
  } else {
    await seekVideosTo(originalTime);
  }
  syncCompareTimeControls();
  updateCompareFramesAndLoss();
  updateCompareInspector();
  setStatus("Ready");
  draw();

  return {
    sampled: results.length,
    results: selected,
  };
}

function firstNonGtCompareIndex() {
  return state.compare.videos.findIndex((_, index) => index !== state.compare.gtIndex);
}

async function runAgentDemo() {
  if (state.agentDemoRunning) return getState();
  state.agentDemoRunning = true;
  setAgentLog(["Goal: find a window by structure, not by brightness."]);
  setStatus("Agent running");

  try {
    if (state.frame?.kind !== "bayer-frame") {
      appendAgentLog("Loading the Bayer sample.");
      await openSampleBayer();
      await sleep(500);
    }

    appendAgentLog("Preparing view: RGB CFA, brightness 2.5x for visibility only.");
    setViewMode("cfa-false-color");
    setBrightness(2.5);
    await sleep(650);

    appendAgentLog("Scanning rectangles for vertical/horizontal frame and grid structure.");
    await sleep(350);
    const { candidates, scanned } = findWindowCandidates();
    state.candidateRegions = candidates.slice(0, 3).map((candidate, index) => ({
      ...candidate.roi,
      label: `#${index + 1}`,
      score: candidate.score,
    }));
    draw();

    appendAgentLog(`Scanned ${scanned} ROIs; showing top ${state.candidateRegions.length}.`);
    for (const [index, candidate] of candidates.slice(0, 3).entries()) {
      appendAgentLog(
        `#${index + 1} x=${candidate.roi.x}, y=${candidate.roi.y}, score=${formatFloat(candidate.score)}, frame=${formatFloat(candidate.frameScore)}, grid=${formatFloat(candidate.gridScore)}, balance=${formatFloat(candidate.balance)}.`,
      );
    }
    await sleep(1200);

    const chosen = candidates[0];
    appendAgentLog(
      `Choosing #1 because it has the strongest frame/grid score without using brightness.`,
    );
    state.selection = chosen.roi;
    draw();
    await sleep(650);

    appendAgentLog("Zooming the chosen window candidate.");
    await focusRegion(chosen.roi);
    await sleep(450);

    const center = {
      x: Math.floor(chosen.roi.x + chosen.roi.width / 2),
      y: Math.floor(chosen.roi.y + chosen.roi.height / 2),
    };
    state.markers = [{ ...center, label: "sample" }];
    draw();
    appendAgentLog(`Reading sample pixel at ${center.x}, ${center.y}.`);
    await sleep(500);

    const pixel = getPixel(center);
    const stats = getRoiStats(chosen.roi);
    appendAgentLog(
      `Pixel: CFA=${pixel.cfa}, raw=${pixel.raw}, norm=${formatFloat(pixel.normalized)}.`,
    );
    appendAgentLog(
      `ROI mean raw=${formatFloat(stats.raw.mean)}; R=${formatFloat(stats.perPlane.R.mean)}, G=${formatFloat((stats.perPlane.Gr.mean + stats.perPlane.Gb.mean) / 2)}, B=${formatFloat(stats.perPlane.B.mean)}.`,
    );
    appendAgentLog("Done. This used structure scoring, then viewer APIs for proof.");
    setStatus("Ready");
    return { chosen, candidates, pixel, stats };
  } finally {
    state.agentDemoRunning = false;
  }
}

async function runBadPixelScanDemo() {
  if (state.agentDemoRunning) return getState();
  state.agentDemoRunning = true;
  setAgentLog(["Goal: detect isolated bad pixels from Bayer raw values."]);
  setStatus("Agent running");

  try {
    if (!state.frame?.defects?.injectedBadPixels) {
      appendAgentLog("Loading synthetic bad-pixel sample with known injected defects.");
      await openBadPixelSample();
      await sleep(500);
    }

    appendAgentLog("Switching to raw mosaic and high brightness for visibility.");
    setViewMode("raw-mosaic");
    setBrightness(4);
    await sleep(500);

    appendAgentLog("Scanning extreme pixels against same-CFA neighbors in a 5x5 ring.");
    await sleep(300);
    const detections = findBadPixels({ threshold: 400, maxResults: 5000 });
    const expected = state.frame.defects?.injectedBadPixels || [];
    const matches = matchBadPixelDetections(expected, detections);
    const matchedDetections = matches.matched.map((match) => match.detected);
    const displayDetections = matchedDetections.length
      ? matchedDetections
      : detections.slice(0, 12);

    state.candidateRegions = displayDetections.slice(0, 12).map((detection, index) => ({
      x: Math.max(0, detection.x - 8),
      y: Math.max(0, detection.y - 8),
      width: 16,
      height: 16,
      label: detection.matchLabel || `#${index + 1}`,
      score: detection.score,
    }));
    state.markers = displayDetections.slice(0, 12).map((detection, index) => ({
      x: detection.x,
      y: detection.y,
      label: detection.matchLabel || `${index + 1}`,
    }));
    draw();

    appendAgentLog(
      `Expected ${expected.length}; candidate pool ${detections.length}; matched ${matches.matched.length}.`,
    );
    for (const match of matches.matched) {
      const detection = match.detected;
      appendAgentLog(
        `${detection.matchLabel} ${detection.type} x=${detection.x}, y=${detection.y}, raw=${detection.raw}, neighbor=${formatFloat(detection.neighborMean)}, score=${formatFloat(detection.score)}, rank=${detection.rank}.`,
      );
    }
    if (matches.missed.length) {
      appendAgentLog(
        `Missed injected: ${matches.missed.map((p) => `${p.type}@${p.x},${p.y}`).join("; ")}.`,
      );
    } else {
      appendAgentLog("All injected bad pixels were matched within 1px.");
    }

    const focusDetection = matchedDetections[0] || detections[0];
    const focusTarget = focusDetection
      ? { x: Math.max(0, focusDetection.x - 26), y: Math.max(0, focusDetection.y - 26), width: 52, height: 52 }
      : { x: 0, y: 0, width: state.frame.width, height: state.frame.height };
    state.selection = focusTarget;
    appendAgentLog("Zooming strongest bad-pixel candidate.");
    await focusRegion(focusTarget);
    setStatus("Ready");
    return { detections, matches };
  } finally {
    state.agentDemoRunning = false;
  }
}

function runTe42Analysis(options = {}) {
  if (state.frame?.kind !== "bayer-frame") {
    throw new Error("Chart analysis needs a Bayer frame.");
  }

  setStatus("Analyzing");
  const result = estimateTe42Features();
  state.te42Analysis = result;

  const regions = [];
  for (const [index, patch] of result.flatPatches.slice(0, 1).entries()) {
    regions.push({
      ...patch.roi,
      label: `SNR${index + 1} ${patch.snrDb.toFixed(0)}dB`,
      score: Number.NaN,
    });
  }
  if (result.mtf.horizontal?.roi) {
    regions.push({
      ...result.mtf.horizontal.roi,
      label: `MTF-H ${result.mtf.horizontal.mtf50.toFixed(3)}`,
      score: Number.NaN,
    });
  }
  if (result.mtf.vertical?.roi) {
    regions.push({
      ...result.mtf.vertical.roi,
      label: `MTF-V ${result.mtf.vertical.mtf50.toFixed(3)}`,
      score: Number.NaN,
    });
  }
  if (result.mtf.star?.roi) {
    regions.push({
      ...result.mtf.star.roi,
      label: `STAR ${result.mtf.star.mtf50.toFixed(3)}`,
      score: Number.NaN,
    });
  }

  state.candidateRegions = regions;
  state.selection = result.mtf.star?.roi || result.mtf.horizontal?.roi || result.mtf.vertical?.roi || result.flatPatches[0]?.roi || null;
  updateTe42AnalysisInspector();
  setAgentLog([
    options.auto ? "Chart source detected; running automatic feature estimation." : "Running chart feature estimation.",
    `Flat patches=${result.flatPatches.length}; SNR median=${formatDb(result.snr.medianDb)}, best=${formatDb(result.snr.bestDb)}.`,
    `Gr-Gb diff=${formatPercent(result.greenDiff.diffPct)} (${formatFloat(result.greenDiff.diffDn)} DN), samples=${result.greenDiff.count}.`,
    `Star MTF50=${formatMtf(result.mtf.star?.mtf50, result.mtf.star?.censored)} (${result.mtf.star?.cycles || "-"} cycles, r=${formatFloat(result.mtf.star?.radius)}).`,
    `Edge MTF50 H=${formatMtf(result.mtf.horizontal?.mtf50)}, V=${formatMtf(result.mtf.vertical?.mtf50)}.`,
    "Method: auto flat-patch scan, Siemens star angular contrast, and strongest-edge MTF50.",
  ]);
  setStatus("Ready");
  draw();
  return result;
}

async function setTe42FaceRoi() {
  if (state.frame?.kind !== "bayer-frame" || !isTe42SourceName()) {
    throw new Error("Face ROI is calibrated for the loaded synthetic chart sample.");
  }

  const roi = normalizeRoi({ x: 345, y: 40, width: 80, height: 58 });
  state.selection = roi;
  state.markers = [{ x: roi.x + Math.round(roi.width * 0.52), y: roi.y + Math.round(roi.height * 0.48), label: "face" }];
  state.candidateRegions = [
    {
      ...roi,
      label: "FACE ROI",
      score: Number.NaN,
    },
  ];
  updateFrameInspector();
  updatePixelInspector(state.pointer ? getPixelFromScreenPoint(state.pointer) : null);
  setAgentLog([
    "Set synthetic chart face ROI from chart image coordinates.",
    `ROI x=${roi.x}, y=${roi.y}, width=${roi.width}, height=${roi.height}.`,
    "This is a fixed sample-coordinate ROI for the checked-in public synthetic chart.",
  ]);
  draw();
  await focusRegion(roi);
  return roi;
}

function estimateTe42Features(options = {}) {
  const frame = options.frame || state.frame;
  if (frame?.kind !== "bayer-frame") {
    throw new Error("Chart feature estimation expects a Bayer frame.");
  }

  const pattern = options.bayerPattern || state.bayerPattern || frame.bayerPattern;
  const inputBitDepth = options.inputBitDepth || state.inputBitDepth || frame.bitDepth;
  const analysis = buildBayerAnalysisImages(frame, pattern, inputBitDepth);
  const gradients = computeAnalysisGradients(analysis.luma, frame.width, frame.height);
  const flatPatches = findFlatAnalysisPatches(analysis, gradients);
  const snr = summarizeFlatPatchSnr(flatPatches);
  const greenDiff = summarizeGreenDifference(frame, pattern, inputBitDepth, flatPatches);
  const horizontal = estimateDirectionalMtf(analysis.luma, gradients, frame.width, frame.height, "horizontal");
  const vertical = estimateDirectionalMtf(analysis.luma, gradients, frame.width, frame.height, "vertical");
  const star = estimateStarChartMtf(analysis.luma, gradients, frame.width, frame.height);
  const confidence = clamp(
    (flatPatches.length ? 0.35 : 0) +
      ((horizontal?.confidence || 0) + (vertical?.confidence || 0)) * 0.22 +
      (star?.confidence || 0) * 0.21,
    0,
    1,
  );

  return {
    kind: "chart-analysis",
    sourceName: state.sourceName,
    width: frame.width,
    height: frame.height,
    inputBitDepth,
    pattern,
    snr,
    greenDiff,
    mtf: { horizontal, vertical, star },
    flatPatches,
    confidence,
    notes: [
      "SNR is estimated from automatically detected low-gradient patches.",
      "Gr-Gb uses only the detected flat patches so chart shift has less impact.",
      "Star MTF50 is estimated from angular contrast around detected Siemens star rings.",
      "MTF50 is an approximate edge-based estimate in cycles/pixel, not a full ISO slanted-edge report.",
    ],
  };
}

function buildBayerAnalysisImages(frame, pattern, inputBitDepth) {
  const count = frame.width * frame.height;
  const lumaImage = new Float32Array(count);
  const whiteLevel = displayWhiteLevel(inputBitDepth);

  for (let blockY = 0; blockY < frame.height; blockY += 2) {
    for (let blockX = 0; blockX < frame.width; blockX += 2) {
      const values = { R: 0, Gr: 0, Gb: 0, B: 0 };
      const counts = { R: 0, Gr: 0, Gb: 0, B: 0 };

      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const x = blockX + dx;
          const y = blockY + dy;
          if (x >= frame.width || y >= frame.height) continue;
          const plane = cfaPlaneAt(pattern, x, y);
          const raw = frame.raw[y * frame.width + x];
          values[plane] += normalizeRawValue(raw, frame.blackLevel, whiteLevel);
          counts[plane] += 1;
        }
      }

      const r = counts.R ? values.R / counts.R : 0;
      const gr = counts.Gr ? values.Gr / counts.Gr : 0;
      const gb = counts.Gb ? values.Gb / counts.Gb : 0;
      const b = counts.B ? values.B / counts.B : 0;
      const g = (gr * counts.Gr + gb * counts.Gb) / Math.max(1, counts.Gr + counts.Gb);
      const blockLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const x = blockX + dx;
          const y = blockY + dy;
          if (x < frame.width && y < frame.height) {
            lumaImage[y * frame.width + x] = blockLuma;
          }
        }
      }
    }
  }

  return { luma: lumaImage, width: frame.width, height: frame.height };
}

function computeAnalysisGradients(values, width, height) {
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const magnitude = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = (values[index + 1] - values[index - 1]) * 0.5;
      const dy = (values[index + width] - values[index - width]) * 0.5;
      gx[index] = Math.abs(dx);
      gy[index] = Math.abs(dy);
      magnitude[index] = Math.sqrt(dx * dx + dy * dy);
    }
  }

  return { gx, gy, magnitude };
}

function findFlatAnalysisPatches(analysis, gradients) {
  const { luma, width, height } = analysis;
  const squared = new Float32Array(luma.length);
  for (let index = 0; index < luma.length; index += 1) {
    squared[index] = luma[index] * luma[index];
  }

  const lumaIntegral = buildIntegralImage(luma, width, height);
  const squareIntegral = buildIntegralImage(squared, width, height);
  const gradientIntegral = buildIntegralImage(gradients.magnitude, width, height);
  const patchSize = clamp(Math.round(Math.min(width, height) * 0.075), 24, 48);
  const step = Math.max(8, Math.round(patchSize / 2));
  const candidates = [];

  for (let y = 4; y <= height - patchSize - 4; y += step) {
    for (let x = 4; x <= width - patchSize - 4; x += step) {
      const area = patchSize * patchSize;
      const mean = rectSum(lumaIntegral, width, x, y, patchSize, patchSize) / area;
      const meanSquare = rectSum(squareIntegral, width, x, y, patchSize, patchSize) / area;
      const std = Math.sqrt(Math.max(0, meanSquare - mean * mean));
      const gradientMean = rectSum(gradientIntegral, width, x, y, patchSize, patchSize) / area;
      const signal = Math.max(mean, 1 / 4095);
      const snr = signal / Math.max(std, 1e-5);
      const snrDb = 20 * Math.log10(snr);
      const midtoneBonus = 1 - Math.min(1, Math.abs(mean - 0.45) / 0.45);
      const score = snrDb + midtoneBonus * 4 - gradientMean * 180 - std * 80;

      if (mean < 0.04 || mean > 0.96) continue;
      candidates.push({
        roi: { x, y, width: patchSize, height: patchSize },
        mean,
        std,
        gradientMean,
        snr,
        snrDb,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return suppressOverlappingCandidates(candidates, 12);
}

function summarizeFlatPatchSnr(flatPatches) {
  if (!flatPatches.length) {
    return { count: 0, medianDb: NaN, meanDb: NaN, bestDb: NaN, worstDb: NaN };
  }

  const sorted = flatPatches.map((patch) => patch.snrDb).sort((a, b) => a - b);
  const meanDb = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    medianDb: percentileSorted(sorted, 50),
    meanDb,
    bestDb: sorted[sorted.length - 1],
    worstDb: sorted[0],
  };
}

function summarizeGreenDifference(frame, pattern, inputBitDepth, flatPatches) {
  const whiteLevel = displayWhiteLevel(inputBitDepth);
  const rois = flatPatches.length
    ? flatPatches.map((patch) => patch.roi)
    : [{ x: 0, y: 0, width: frame.width, height: frame.height }];
  let grSum = 0;
  let gbSum = 0;
  let grCount = 0;
  let gbCount = 0;

  for (const roi of rois) {
    for (let y = roi.y; y < roi.y + roi.height; y += 1) {
      for (let x = roi.x; x < roi.x + roi.width; x += 1) {
        const plane = cfaPlaneAt(pattern, x, y);
        if (plane !== "Gr" && plane !== "Gb") continue;
        const normalized = normalizeRawValue(
          frame.raw[y * frame.width + x],
          frame.blackLevel,
          whiteLevel,
        );
        if (plane === "Gr") {
          grSum += normalized;
          grCount += 1;
        } else {
          gbSum += normalized;
          gbCount += 1;
        }
      }
    }
  }

  const grMean = grCount ? grSum / grCount : NaN;
  const gbMean = gbCount ? gbSum / gbCount : NaN;
  const diff = grMean - gbMean;
  const greenMean = (grMean + gbMean) / 2;
  return {
    grMean,
    gbMean,
    diff,
    diffDn: diff * Math.max(1, whiteLevel - (frame.blackLevel ?? 0)),
    diffPct: greenMean ? (diff / greenMean) * 100 : NaN,
    count: grCount + gbCount,
    rois: rois.length,
  };
}

function estimateStarChartMtf(lumaImage, gradients, width, height) {
  const candidates = findStarChartCandidates(lumaImage, gradients, width, height);
  const measured = [];

  for (const candidate of candidates.slice(0, 8)) {
    const mtf = measureStarCandidateMtf(lumaImage, width, height, candidate);
    if (!mtf) continue;
    measured.push({
      ...mtf,
      score: candidate.score,
      confidence: clamp(candidate.score * 0.45 + mtf.fitQuality * 0.55, 0, 1),
    });
  }

  measured.sort((a, b) => (b.confidence + b.mtf50 * 0.35) - (a.confidence + a.mtf50 * 0.35));
  return measured[0] || null;
}

function findStarChartCandidates(lumaImage, gradients, width, height) {
  const minSize = Math.min(width, height);
  const radii = [
    Math.round(minSize * 0.11),
    Math.round(minSize * 0.15),
    Math.round(minSize * 0.19),
    Math.round(minSize * 0.23),
  ];
  const candidates = [];

  for (const radius of radii) {
    const step = Math.max(10, Math.round(radius * 0.32));
    for (let cy = radius + 8; cy < height - radius - 8; cy += step) {
      for (let cx = radius + 8; cx < width - radius - 8; cx += step) {
        const score = scoreStarCandidate(lumaImage, width, height, cx, cy, radius);
        if (!score || score.score < 0.12) continue;
        candidates.push({
          center: { x: cx, y: cy },
          radius,
          roi: {
            x: clamp(Math.round(cx - radius), 0, width - 1),
            y: clamp(Math.round(cy - radius), 0, height - 1),
            width: clamp(Math.round(radius * 2), 1, width),
            height: clamp(Math.round(radius * 2), 1, height),
          },
          ...score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of candidates) {
    const roi = candidate.roi;
    if (selected.some((existing) => roiIou(existing.roi, roi) > 0.45)) continue;
    selected.push(candidate);
    if (selected.length >= 12) break;
  }
  return selected;
}

function scoreStarCandidate(lumaImage, width, height, cx, cy, radius) {
  const ringFractions = [0.38, 0.5, 0.64, 0.78];
  const scores = [];
  const cycles = [];

  for (const fraction of ringFractions) {
    const ringRadius = radius * fraction;
    const values = sampleRing(lumaImage, width, height, cx, cy, ringRadius, 192);
    if (!values) continue;
    const stats = ringStats(values);
    if (stats.std < 0.025) continue;
    const peak = dominantAngularFrequency(values, 18, 120);
    if (!peak || peak.frequency < 18) continue;
    const frequencyBias = clamp(Math.sqrt(peak.frequency / 32), 0.65, 2.2);
    scores.push(clamp((peak.normalizedAmplitude * stats.std * 7 * frequencyBias) / 0.35, 0, 1));
    cycles.push(peak.frequency);
  }

  if (scores.length < 2) return null;
  const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const sortedCycles = cycles.slice().sort((a, b) => a - b);
  return {
    score,
    cyclesHint: Math.round(percentileSorted(sortedCycles, 50)),
    ringCount: scores.length,
  };
}

function measureStarCandidateMtf(lumaImage, width, height, candidate) {
  const radius = candidate.radius;
  const cx = refineStarCenter(lumaImage, width, height, candidate.center.x, candidate.center.y, radius);
  const cy = cx.y;
  const centerX = cx.x;
  const outerRadius = radius * 0.88;
  const innerRadius = Math.max(8, radius * 0.16);
  const rings = [];
  let cycles = candidate.cyclesHint;

  for (let r = outerRadius; r >= innerRadius; r -= Math.max(2, radius * 0.035)) {
    const sampleCount = clamp(Math.round(256 + cycles * 2), 192, 512);
    const values = sampleRing(lumaImage, width, height, centerX, cy, r, sampleCount);
    if (!values) continue;
    const stats = ringStats(values);
    if (stats.std < 0.01) continue;
    const peak = dominantAngularFrequency(values, Math.max(18, cycles - 10), Math.min(128, cycles + 10));
    if (!peak) continue;
    cycles = Math.max(18, Math.round(lerp(cycles, peak.frequency, 0.25)));
    const contrast = clamp((2 * peak.amplitude) / Math.max(0.02, stats.max - stats.min), 0, 2);
    rings.push({
      radius: r,
      frequency: peak.frequency / (2 * Math.PI * r),
      contrast,
      amplitude: peak.amplitude,
      angularFrequency: peak.frequency,
      std: stats.std,
    });
  }

  if (rings.length < 5) return null;
  rings.sort((a, b) => a.frequency - b.frequency);
  const baselineRings = rings.slice(0, Math.max(2, Math.ceil(rings.length * 0.25)));
  const baseline = Math.max(
    1e-4,
    baselineRings.reduce((sum, ring) => sum + ring.contrast, 0) / baselineRings.length,
  );
  const normalized = rings.map((ring) => ({
    ...ring,
    mtf: clamp(ring.contrast / baseline, 0, 1.4),
  }));

  let mtf50 = NaN;
  for (let index = 1; index < normalized.length; index += 1) {
    const prev = normalized[index - 1];
    const next = normalized[index];
    if (prev.mtf >= 0.5 && next.mtf <= 0.5) {
      const t = (0.5 - prev.mtf) / Math.max(1e-6, next.mtf - prev.mtf);
      mtf50 = lerp(prev.frequency, next.frequency, clamp(t, 0, 1));
      break;
    }
  }

  const censored = !Number.isFinite(mtf50);
  if (censored) {
    mtf50 = normalized[normalized.length - 1].mtf >= 0.5
      ? normalized[normalized.length - 1].frequency
      : normalized[0].frequency;
  }

  const roiRadius = radius * 0.92;
  const roi = {
    x: clamp(Math.round(centerX - roiRadius), 0, width - 1),
    y: clamp(Math.round(cy - roiRadius), 0, height - 1),
    width: clamp(Math.round(roiRadius * 2), 1, width),
    height: clamp(Math.round(roiRadius * 2), 1, height),
  };
  const fitQuality = clamp(
    (candidate.score * 0.5) +
      Math.min(1, normalized.length / 14) * 0.25 +
      Math.min(1, baseline * 1.8) * 0.25,
    0,
    1,
  );

  return {
    type: "siemens-star",
    center: { x: centerX, y: cy },
    radius: roiRadius,
    roi,
    cycles,
    mtf50: clamp(mtf50, 0, 0.5),
    censored,
    fitQuality,
    baselineContrast: baseline,
    rings: normalized,
  };
}

function refineStarCenter(lumaImage, width, height, cx, cy, radius) {
  let best = { x: cx, y: cy, score: -Infinity };
  const search = Math.max(3, Math.round(radius * 0.08));
  const step = Math.max(1, Math.round(search / 3));

  for (let y = cy - search; y <= cy + search; y += step) {
    for (let x = cx - search; x <= cx + search; x += step) {
      const score = scoreStarCandidate(lumaImage, width, height, x, y, radius)?.score ?? -Infinity;
      if (score > best.score) best = { x, y, score };
    }
  }

  return { x: best.x, y: best.y };
}

function sampleRing(values, width, height, cx, cy, radius, sampleCount) {
  const out = new Float64Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const angle = (index / sampleCount) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (x < 1 || x >= width - 2 || y < 1 || y >= height - 2) return null;
    out[index] = sampleBilinear(values, width, height, x, y);
  }
  return out;
}

function sampleBilinear(values, width, height, x, y) {
  const x0 = clamp(Math.floor(x), 0, width - 1);
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = values[y0 * width + x0];
  const b = values[y0 * width + x1];
  const c = values[y1 * width + x0];
  const d = values[y1 * width + x1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function ringStats(values) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let squareSum = 0;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    squareSum += value * value;
  }
  const mean = sum / values.length;
  const variance = Math.max(0, squareSum / values.length - mean * mean);
  return { min, max, mean, std: Math.sqrt(variance) };
}

function dominantAngularFrequency(values, minFrequency, maxFrequency) {
  const count = values.length;
  const stats = ringStats(values);
  let best = null;
  const start = clamp(Math.floor(minFrequency), 1, Math.floor(count / 2) - 1);
  const end = clamp(Math.ceil(maxFrequency), start, Math.floor(count / 2) - 1);

  for (let frequency = start; frequency <= end; frequency += 1) {
    let real = 0;
    let imag = 0;
    for (let index = 0; index < count; index += 1) {
      const centered = values[index] - stats.mean;
      const angle = (Math.PI * 2 * frequency * index) / count;
      real += centered * Math.cos(angle);
      imag -= centered * Math.sin(angle);
    }
    const amplitude = (2 * Math.sqrt(real * real + imag * imag)) / count;
    const normalizedAmplitude = stats.std ? amplitude / (stats.std * Math.SQRT2) : 0;
    if (!best || normalizedAmplitude > best.normalizedAmplitude) {
      best = { frequency, amplitude, normalizedAmplitude };
    }
  }

  return best;
}

function estimateDirectionalMtf(lumaImage, gradients, width, height, direction) {
  const isHorizontal = direction === "horizontal";
  const edgeMap = isHorizontal ? gradients.gx : gradients.gy;
  const crossMap = isHorizontal ? gradients.gy : gradients.gx;
  const edgeIntegral = buildIntegralImage(edgeMap, width, height);
  const crossIntegral = buildIntegralImage(crossMap, width, height);
  const lumaIntegral = buildIntegralImage(lumaImage, width, height);
  const roiWidth = isHorizontal
    ? clamp(Math.round(width * 0.085), 30, 72)
    : clamp(Math.round(width * 0.17), 48, 110);
  const roiHeight = isHorizontal
    ? clamp(Math.round(height * 0.17), 48, 110)
    : clamp(Math.round(height * 0.085), 30, 72);
  const stepX = Math.max(8, Math.round(roiWidth / 3));
  const stepY = Math.max(8, Math.round(roiHeight / 3));
  const candidates = [];

  for (let y = 6; y <= height - roiHeight - 6; y += stepY) {
    for (let x = 6; x <= width - roiWidth - 6; x += stepX) {
      const area = roiWidth * roiHeight;
      const edgeMean = rectSum(edgeIntegral, width, x, y, roiWidth, roiHeight) / area;
      const crossMean = rectSum(crossIntegral, width, x, y, roiWidth, roiHeight) / area;
      const contrast = isHorizontal
        ? splitContrast(lumaIntegral, width, x, y, roiWidth, roiHeight, "x")
        : splitContrast(lumaIntegral, width, x, y, roiWidth, roiHeight, "y");
      if (contrast < 0.08 || edgeMean < 0.006) continue;
      candidates.push({
        roi: { x, y, width: roiWidth, height: roiHeight },
        edgeMean,
        crossMean,
        contrast,
        score: edgeMean * contrast * (1 / (crossMean + 0.006)),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const measured = [];
  for (const candidate of candidates.slice(0, 24)) {
    const mtf = estimateMtfFromEdgeRoi(lumaImage, width, height, candidate.roi, direction);
    if (mtf) {
      const confidence = clamp((mtf.profileCount / 28) * 0.65 + candidate.contrast * 1.2, 0, 1);
      measured.push({
        ...mtf,
        edgeMean: candidate.edgeMean,
        crossMean: candidate.crossMean,
        score: candidate.score,
        confidence,
        rankScore: confidence * 0.45 + candidate.contrast * 1.5 + mtf.mtf50 * 0.6,
      });
    }
  }

  measured.sort((a, b) => b.rankScore - a.rankScore);
  return measured[0] || null;
}

function splitContrast(integral, width, x, y, roiWidth, roiHeight, axis) {
  if (axis === "x") {
    const side = Math.max(4, Math.floor(roiWidth / 3));
    const left = rectAverage(integral, width, x, y, side, roiHeight);
    const right = rectAverage(integral, width, x + roiWidth - side, y, side, roiHeight);
    return Math.abs(right - left);
  }
  const side = Math.max(4, Math.floor(roiHeight / 3));
  const top = rectAverage(integral, width, x, y, roiWidth, side);
  const bottom = rectAverage(integral, width, x, y + roiHeight - side, roiWidth, side);
  return Math.abs(bottom - top);
}

function estimateMtfFromEdgeRoi(lumaImage, width, height, roi, direction) {
  const radius = 14;
  const profileLength = radius * 2 + 1;
  const profileEntries = [];
  const isHorizontal = direction === "horizontal";
  const lineStart = isHorizontal ? roi.y + 3 : roi.x + 3;
  const lineEnd = isHorizontal ? roi.y + roi.height - 3 : roi.x + roi.width - 3;

  for (let line = lineStart; line < lineEnd; line += 1) {
    const edge = findStrongestLineEdge(lumaImage, width, height, roi, line, direction);
    if (!edge || edge.strength < 0.05) continue;
    const profile = sampleEdgeProfile(lumaImage, width, height, edge.center, line, radius, direction);
    if (!profile) continue;
    profileEntries.push({ profile, center: edge.center, line });
  }

  if (profileEntries.length < 8) return null;

  const sortedCenters = profileEntries.map((entry) => entry.center).sort((a, b) => a - b);
  const medianCenter = percentileSorted(sortedCenters, 50);
  const centerTolerance = Math.max(4, Math.round(radius * 0.55));
  const coherentEntries = profileEntries.filter(
    (entry) => Math.abs(entry.center - medianCenter) <= centerTolerance,
  );
  const entries = coherentEntries.length >= 8 ? coherentEntries : profileEntries;
  const profiles = entries.map((entry) => entry.profile);

  const averageProfile = new Float64Array(profileLength);
  for (const profile of profiles) {
    for (let index = 0; index < profileLength; index += 1) {
      averageProfile[index] += profile[index];
    }
  }
  for (let index = 0; index < profileLength; index += 1) {
    averageProfile[index] /= profiles.length;
  }

  const low = averageProfile.slice(0, 4).reduce((sum, value) => sum + value, 0) / 4;
  const high = averageProfile.slice(-4).reduce((sum, value) => sum + value, 0) / 4;
  const contrast = Math.abs(high - low);
  if (contrast < 0.06) return null;

  const normalized = Array.from(averageProfile, (value) => clamp((value - low) / (high - low), 0, 1));
  const x10 = findProfileCrossing(normalized, 0.1);
  const x90 = findProfileCrossing(normalized, 0.9);
  if (!Number.isFinite(x10) || !Number.isFinite(x90)) return null;

  const risePixels = Math.max(0.5, Math.abs(x90 - x10));
  const mtf50 = clamp(0.443 / risePixels, 0, 0.5);
  const tightRoi = tightEdgeRoiFromProfiles(entries, medianCenter, radius, direction, width, height);
  return {
    direction,
    roi: tightRoi,
    sourceRoi: roi,
    mtf50,
    risePixels,
    contrast,
    profileCount: profiles.length,
    profile: normalized,
  };
}

function tightEdgeRoiFromProfiles(entries, medianCenter, radius, direction, width, height) {
  const isHorizontal = direction === "horizontal";
  const lines = entries.map((entry) => entry.line);
  const minLine = Math.min(...lines);
  const maxLine = Math.max(...lines);
  const padding = 4;

  if (isHorizontal) {
    const x = clamp(Math.floor(medianCenter - radius - padding), 0, width - 1);
    const x2 = clamp(Math.ceil(medianCenter + radius + padding), x + 1, width);
    const y = clamp(minLine - padding, 0, height - 1);
    const y2 = clamp(maxLine + padding, y + 1, height);
    return { x, y, width: x2 - x, height: y2 - y };
  }

  const x = clamp(minLine - padding, 0, width - 1);
  const x2 = clamp(maxLine + padding, x + 1, width);
  const y = clamp(Math.floor(medianCenter - radius - padding), 0, height - 1);
  const y2 = clamp(Math.ceil(medianCenter + radius + padding), y + 1, height);
  return { x, y, width: x2 - x, height: y2 - y };
}

function findStrongestLineEdge(lumaImage, width, height, roi, line, direction) {
  const isHorizontal = direction === "horizontal";
  let best = null;
  const start = isHorizontal ? roi.x + 4 : roi.y + 4;
  const end = isHorizontal ? roi.x + roi.width - 4 : roi.y + roi.height - 4;

  for (let position = start; position < end; position += 1) {
    const x = isHorizontal ? position : line;
    const y = isHorizontal ? line : position;
    if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) continue;
    const index = y * width + x;
    const delta = isHorizontal
      ? lumaImage[index + 1] - lumaImage[index - 1]
      : lumaImage[index + width] - lumaImage[index - width];
    const strength = Math.abs(delta);
    if (!best || strength > best.strength) {
      best = { center: position, strength };
    }
  }

  return best;
}

function sampleEdgeProfile(lumaImage, width, height, center, line, radius, direction) {
  const isHorizontal = direction === "horizontal";
  const values = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const x = isHorizontal ? center + offset : line;
    const y = isHorizontal ? line : center + offset;
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    values.push(lumaImage[y * width + x]);
  }

  const start = values.slice(0, 4).reduce((sum, value) => sum + value, 0) / 4;
  const end = values.slice(-4).reduce((sum, value) => sum + value, 0) / 4;
  if (Math.abs(end - start) < 0.05) return null;
  return end >= start ? values : values.reverse();
}

function findProfileCrossing(profile, threshold) {
  for (let index = 1; index < profile.length; index += 1) {
    const prev = profile[index - 1];
    const next = profile[index];
    if ((prev <= threshold && next >= threshold) || (prev >= threshold && next <= threshold)) {
      const denom = next - prev;
      const t = Math.abs(denom) < 1e-8 ? 0 : (threshold - prev) / denom;
      return index - 1 + clamp(t, 0, 1);
    }
  }
  return NaN;
}

async function readBayerInput(input) {
  if (input.metadata && input.rawBuffer) {
    return {
      metadata: input.metadata,
      rawBuffer: input.rawBuffer,
      name: input.name || "Bayer ArrayBuffer",
    };
  }

  if (input.metadataFile) {
    const metadata = JSON.parse(await input.metadataFile.text());
    const rawFile = input.rawFile || findRawFileForMetadata(input.metadataFile, metadata);
    if (!rawFile) {
      throw new Error("Select the Bayer .raw file together with the .json sidecar.");
    }
    return {
      metadata,
      rawBuffer: await rawFile.arrayBuffer(),
      name: input.metadataFile.name,
    };
  }

  if (input.metadataUrl) {
    const metadataResponse = await fetch(input.metadataUrl);
    if (!metadataResponse.ok) {
      throw new Error(`Could not fetch Bayer sidecar: ${metadataResponse.status}`);
    }
    const metadata = await metadataResponse.json();
    const rawUrl =
      input.rawUrl || resolveArtifactUrl(metadata.artifacts?.raw, input.metadataUrl);
    const rawResponse = await fetch(rawUrl);
    if (!rawResponse.ok) {
      throw new Error(`Could not fetch Bayer raw: ${rawResponse.status}`);
    }
    return {
      metadata,
      rawBuffer: await rawResponse.arrayBuffer(),
      name: input.name || decodeURIComponent(input.metadataUrl.split("/").pop() || "bayer.json"),
    };
  }

  throw new Error("openBayer expects metadata/raw buffers, files, or URLs.");
}

function findRawFileForMetadata(metadataFile, metadata, rawFiles = Array.from(els.fileInput.files || [])) {
  const expected = metadata.artifacts?.raw
    ? metadata.artifacts.raw.replaceAll("\\", "/").split("/").pop()
    : metadataFile.name.replace(/\.json$/i, ".raw");
  const list = Array.from(rawFiles || []);
  return list.find((file) => file.name === expected) || list.find((file) => file.name.endsWith(".raw"));
}

function resolveArtifactUrl(path, metadataUrl) {
  if (!path) throw new Error("Bayer sidecar does not include artifacts.raw.");
  const normalized = String(path).replaceAll("\\", "/");
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("/")) {
    return normalized;
  }
  if (normalized.startsWith("data/")) {
    return `/${normalized}`;
  }
  return new URL(normalized, metadataUrl).toString();
}

async function readBinaryInput(input) {
  if (typeof input === "string") {
    const response = await fetch(input);
    if (!response.ok) throw new Error(`Could not fetch input: ${response.status}`);
    return {
      buffer: await response.arrayBuffer(),
      name: decodeURIComponent(input.split("/").pop() || "remote.hdr"),
    };
  }
  if (input instanceof File) {
    return {
      buffer: await input.arrayBuffer(),
      name: input.name,
    };
  }
  if (input instanceof ArrayBuffer) {
    return {
      buffer: input,
      name: "ArrayBuffer",
    };
  }
  throw new Error("Expected a URL, File, or ArrayBuffer.");
}

function setViewMode(mode) {
  if (!VIEW_MODES.some(([value]) => value === mode)) {
    throw new Error(`Unsupported view mode: ${mode}`);
  }
  if (state.frame?.kind !== "bayer-frame" && mode !== "demosaic-preview") {
    mode = "demosaic-preview";
  }
  state.viewMode = mode;
  syncControls();
  renderCurrentFrame();
  updateFrameInspector();
  draw();
  return getState();
}

function setInputBitDepth(bitDepth) {
  state.inputBitDepth = clamp(Math.round(Number(bitDepth) || 1), 1, 16);
  syncControls();
  renderCurrentFrame();
  updateFrameInspector();
  updatePixelInspector(state.pointer ? getPixelFromScreenPoint(state.pointer) : null);
  draw();
  return state.inputBitDepth;
}

function setBrightness(multiplier) {
  const value = clampFinite(multiplier, 0.01, 64);
  return setBrightnessEv(Math.log2(value));
}

function setBrightnessEv(exposureEv) {
  state.tone.exposureEv = clampFinite(exposureEv, -4, 6);
  syncControls();
  renderCurrentFrame();
  updatePixelInspector(state.pointer ? getPixelFromScreenPoint(state.pointer) : null);
  draw();
  return {
    multiplier: 2 ** state.tone.exposureEv,
    exposureEv: state.tone.exposureEv,
  };
}

function setWhiteBalance(gains) {
  state.wbGains = {
    r: clampFinite(gains.r ?? state.wbGains.r, 0, 8),
    g: clampFinite(gains.g ?? state.wbGains.g, 0, 8),
    b: clampFinite(gains.b ?? state.wbGains.b, 0, 8),
  };
  syncControls();
  renderCurrentFrame();
  updatePixelInspector(state.pointer ? getPixelFromScreenPoint(state.pointer) : null);
  draw();
  return { ...state.wbGains };
}

function setBayerPattern(pattern) {
  if (!BAYER_PATTERNS.includes(pattern)) {
    throw new Error(`Unsupported Bayer pattern: ${pattern}`);
  }
  state.bayerPattern = pattern;
  syncControls();
  renderCurrentFrame();
  updateFrameInspector();
  updatePixelInspector(state.pointer ? getPixelFromScreenPoint(state.pointer) : null);
  draw();
  return pattern;
}

function renderCurrentFrame() {
  if (!state.frame) return;

  const imageData =
    state.frame.kind === "bayer-frame"
      ? createBayerImageData(state.frame, {
          viewMode: state.viewMode,
          bayerPattern: state.bayerPattern,
          inputBitDepth: state.inputBitDepth,
          wbGains: expandedWhiteBalance(),
          tone: state.tone,
        })
      : createToneMappedImageData(state.frame, {
          ...state.tone,
          wbGains: state.wbGains,
        });

  imageCanvas.width = state.frame.width;
  imageCanvas.height = state.frame.height;
  imageCtx.putImageData(imageData, 0, 0);
}

function findWindowCandidates() {
  if (state.frame?.kind !== "bayer-frame") {
    throw new Error("Window search needs a Bayer frame.");
  }

  const frame = state.frame;
  const whiteLevel = displayWhiteLevel(state.inputBitDepth);
  const brightness = new Float32Array(frame.width * frame.height);
  const verticalEdges = new Float32Array(frame.width * frame.height);
  const horizontalEdges = new Float32Array(frame.width * frame.height);

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const index = y * frame.width + x;
      const value = normalizeRawValue(frame.raw[index], frame.blackLevel, whiteLevel);
      brightness[index] = value;
      if (x > 0) verticalEdges[index] = Math.abs(value - brightness[index - 1]);
      if (y > 0) horizontalEdges[index] = Math.abs(value - brightness[index - frame.width]);
    }
  }

  const verticalIntegral = buildIntegralImage(verticalEdges, frame.width, frame.height);
  const horizontalIntegral = buildIntegralImage(horizontalEdges, frame.width, frame.height);
  const sizes = [
    { width: 120, height: 130 },
    { width: 150, height: 110 },
    { width: 180, height: 130 },
    { width: 210, height: 150 },
  ];
  const scored = [];
  let scanned = 0;

  for (const size of sizes) {
    const maxY = Math.min(frame.height - size.height - 1, Math.floor(frame.height * 0.64));
    for (let y = 40; y <= maxY; y += 20) {
      for (let x = 60; x <= frame.width - size.width - 60; x += 20) {
        const structure = scoreWindowStructure(
          verticalIntegral,
          horizontalIntegral,
          frame.width,
          frame.height,
          { x, y, width: size.width, height: size.height },
        );
        const upperBias =
          1 - Math.min(1, Math.abs(y + size.height / 2 - frame.height * 0.36) / (frame.height * 0.42));
        const centerBias =
          1 - Math.min(1, Math.abs(x + size.width / 2 - frame.width * 0.58) / (frame.width * 0.58));
        const score = structure.score + upperBias * 0.05 + centerBias * 0.03;

        scored.push({
          roi: { x, y, width: size.width, height: size.height },
          score,
          ...structure,
        });
        scanned += 1;
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    scanned,
    candidates: suppressOverlappingCandidates(scored, 5),
  };
}

function findBadPixels(options = {}) {
  if (state.frame?.kind !== "bayer-frame") {
    throw new Error("Bad pixel scan needs a Bayer frame.");
  }

  const threshold = Number(options.threshold ?? 950);
  const maxResults = Number(options.maxResults ?? 50);
  const frame = state.frame;
  const detections = [];

  for (let y = 2; y < frame.height - 2; y += 1) {
    for (let x = 2; x < frame.width - 2; x += 1) {
      const index = y * frame.width + x;
      const raw = frame.raw[index];
      const isHotExtreme = raw >= frame.whiteLevel - 4;
      const isDeadExtreme = raw <= frame.blackLevel + 4;
      if (!isHotExtreme && !isDeadExtreme) continue;

      const samePlaneValues = [];

      for (let dy = -2; dy <= 2; dy += 2) {
        for (let dx = -2; dx <= 2; dx += 2) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          samePlaneValues.push(frame.raw[ny * frame.width + nx]);
        }
      }

      const neighborMean =
        samePlaneValues.reduce((sum, value) => sum + value, 0) / samePlaneValues.length;
      const sorted = samePlaneValues.slice().sort((a, b) => a - b);
      const neighborMedian = sorted[Math.floor(sorted.length / 2)];
      const delta = raw - neighborMedian;
      const score = Math.abs(delta);

      if (score < threshold) continue;

      let type = null;
      if (isHotExtreme && delta > 0) type = "hot";
      if (isDeadExtreme && delta < 0) type = "dead";
      if (!type) continue;

      const immediate = immediateNeighborValues(frame, x, y);
      if (type === "hot" && immediate.some((value) => value >= frame.whiteLevel - 4)) {
        continue;
      }
      if (type === "dead" && immediate.some((value) => value <= frame.blackLevel + 4)) {
        continue;
      }

      detections.push({
        x,
        y,
        cfa: cfaPlaneAt(state.bayerPattern, x, y),
        raw,
        type,
        score,
        neighborMean,
        neighborMedian,
      });
    }
  }

  detections.sort((a, b) => b.score - a.score);
  return detections.slice(0, maxResults).map((detection, index) => ({
    ...detection,
    rank: index + 1,
  }));
}

function immediateNeighborValues(frame, x, y) {
  const values = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      values.push(frame.raw[(y + dy) * frame.width + x + dx]);
    }
  }
  return values;
}

function matchBadPixelDetections(expected, detections) {
  const unmatched = new Set(detections.map((_, index) => index));
  const matched = [];
  const missed = [];

  for (const [expectedIndex, pixel] of expected.entries()) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of unmatched) {
      const detection = detections[index];
      if (detection.type !== pixel.type) continue;
      const distance = Math.max(Math.abs(detection.x - pixel.x), Math.abs(detection.y - pixel.y));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0 && bestDistance <= 1) {
      const detected = {
        ...detections[bestIndex],
        matchLabel: `M${expectedIndex + 1}`,
      };
      matched.push({ expected: pixel, detected, distance: bestDistance });
      unmatched.delete(bestIndex);
    } else {
      missed.push(pixel);
    }
  }

  return {
    matched,
    missed,
    extra: Array.from(unmatched).map((index) => detections[index]),
  };
}

function scoreWindowStructure(verticalIntegral, horizontalIntegral, width, height, roi) {
  const border = Math.max(8, Math.round(Math.min(roi.width, roi.height) * 0.1));
  const innerX = roi.x + border;
  const innerY = roi.y + border;
  const innerWidth = Math.max(1, roi.width - border * 2);
  const innerHeight = Math.max(1, roi.height - border * 2);
  const roiArea = roi.width * roi.height;

  const vertical = rectAverage(verticalIntegral, width, roi.x, roi.y, roi.width, roi.height);
  const horizontal = rectAverage(horizontalIntegral, width, roi.x, roi.y, roi.width, roi.height);
  const balance = Math.min(vertical, horizontal) / Math.max(vertical, horizontal, 0.0001);

  const left = rectAverage(verticalIntegral, width, roi.x, roi.y, border, roi.height);
  const right = rectAverage(
    verticalIntegral,
    width,
    roi.x + roi.width - border,
    roi.y,
    border,
    roi.height,
  );
  const top = rectAverage(horizontalIntegral, width, roi.x, roi.y, roi.width, border);
  const bottom = rectAverage(
    horizontalIntegral,
    width,
    roi.x,
    roi.y + roi.height - border,
    roi.width,
    border,
  );
  const frameScore = (left + right + top + bottom) / 4;

  const vGrid = strongestVerticalInteriorLine(
    verticalIntegral,
    width,
    height,
    innerX,
    innerY,
    innerWidth,
    innerHeight,
    border,
  );
  const hGrid = strongestHorizontalInteriorLine(
    horizontalIntegral,
    width,
    height,
    innerX,
    innerY,
    innerWidth,
    innerHeight,
    border,
  );
  const gridScore = (vGrid + hGrid) / 2;
  const aspect = roi.width / roi.height;
  const aspectScore = Math.max(0, 1 - Math.abs(aspect - 1.25) / 1.25);

  return {
    score:
      frameScore * 2.4 +
      gridScore * 2.1 +
      balance * 0.45 +
      aspectScore * 0.2 +
      (vertical + horizontal) * 0.55,
    frameScore,
    gridScore,
    balance,
    vertical,
    horizontal,
    aspectScore,
    roiArea,
  };
}

function strongestVerticalInteriorLine(integral, width, height, x, y, roiWidth, roiHeight, border) {
  let best = 0;
  const lineWidth = Math.max(4, Math.round(border * 0.55));
  const start = x + Math.round(roiWidth * 0.22);
  const end = x + Math.round(roiWidth * 0.78);
  for (let lineX = start; lineX <= end; lineX += Math.max(6, lineWidth)) {
    const clampedX = clamp(lineX - Math.floor(lineWidth / 2), 0, width - lineWidth);
    best = Math.max(best, rectAverage(integral, width, clampedX, y, lineWidth, roiHeight));
  }
  return best;
}

function strongestHorizontalInteriorLine(integral, width, height, x, y, roiWidth, roiHeight, border) {
  let best = 0;
  const lineHeight = Math.max(4, Math.round(border * 0.55));
  const start = y + Math.round(roiHeight * 0.22);
  const end = y + Math.round(roiHeight * 0.78);
  for (let lineY = start; lineY <= end; lineY += Math.max(6, lineHeight)) {
    const clampedY = clamp(lineY - Math.floor(lineHeight / 2), 0, height - lineHeight);
    best = Math.max(best, rectAverage(integral, width, x, clampedY, roiWidth, lineHeight));
  }
  return best;
}

function suppressOverlappingCandidates(candidates, limit) {
  const picked = [];
  for (const candidate of candidates) {
    if (picked.every((existing) => roiIou(existing.roi, candidate.roi) < 0.35)) {
      picked.push(candidate);
    }
    if (picked.length >= limit) break;
  }
  return picked;
}

function rectAverage(integral, width, x, y, roiWidth, roiHeight) {
  return rectSum(integral, width, x, y, roiWidth, roiHeight) / Math.max(1, roiWidth * roiHeight);
}

function buildIntegralImage(values, width, height) {
  const integral = new Float64Array((width + 1) * (height + 1));
  const stride = width + 1;

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += values[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }

  return integral;
}

function rectSum(integral, width, x, y, roiWidth, roiHeight) {
  const stride = width + 1;
  const x2 = x + roiWidth;
  const y2 = y + roiHeight;
  return (
    integral[y2 * stride + x2] -
    integral[y * stride + x2] -
    integral[y2 * stride + x] +
    integral[y * stride + x]
  );
}

function roiIou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

async function focusRegion(region) {
  if (!state.frame) return;
  resizeCanvas();
  const rect = els.canvas.getBoundingClientRect();
  const targetScale = clamp(
    Math.min((rect.width - 84) / region.width, (rect.height - 84) / region.height),
    0.05,
    64,
  );
  const targetOffsetX = rect.width / 2 - (region.x + region.width / 2) * targetScale;
  const targetOffsetY = rect.height / 2 - (region.y + region.height / 2) * targetScale;
  const start = { ...state.viewport };
  const steps = 18;

  for (let i = 1; i <= steps; i += 1) {
    const t = easeInOut(i / steps);
    state.viewport.scale = lerp(start.scale, targetScale, t);
    state.viewport.offsetX = lerp(start.offsetX, targetOffsetX, t);
    state.viewport.offsetY = lerp(start.offsetY, targetOffsetY, t);
    updateViewState();
    draw();
    await sleep(28);
  }
}

async function focusSelectedRegion() {
  if (!state.selection) {
    throw new Error("Select an ROI before zooming.");
  }
  if (state.compare.active) {
    await focusCompareRegion(state.selection);
  } else {
    await focusRegion(state.selection);
  }
  return { ...state.selection };
}

async function focusCompareRegion(region) {
  if (!state.compare.active) return;
  const roi = normalizeCompareRoi(region);
  if (!roi.width || !roi.height) return;
  resizeCanvas();
  const rect = els.canvas.getBoundingClientRect();
  const tiles = computeCompareTileRects(rect.width, rect.height);
  state.compare.tileRects = tiles;
  const tile = tiles.find((item) => !item.isDiff && item.index === state.compare.gtIndex)
    || tiles.find((item) => !item.isDiff)
    || tiles[0];
  if (!tile) return;
  const imageRect = tile.imageRect;
  const margin = 36;
  const targetScale = clamp(
    Math.min((imageRect.width - margin) / roi.width, (imageRect.height - margin) / roi.height),
    0.05,
    64,
  );
  const targetOffsetX = imageRect.width / 2 - (roi.x + roi.width / 2) * targetScale;
  const targetOffsetY = imageRect.height / 2 - (roi.y + roi.height / 2) * targetScale;
  const start = { ...state.compare.view };
  const steps = 18;

  for (let i = 1; i <= steps; i += 1) {
    const t = easeInOut(i / steps);
    state.compare.view.scale = lerp(start.scale, targetScale, t);
    state.compare.view.offsetX = lerp(start.offsetX, targetOffsetX, t);
    state.compare.view.offsetY = lerp(start.offsetY, targetOffsetY, t);
    updateViewState();
    draw();
    await sleep(28);
  }
}

async function zoomSelectionFromContextMenu(event) {
  if (!state.selection) return false;
  const point = eventToCanvasPoint(event);
  if (!screenPointInSelection(point)) return false;
  await focusSelectedRegion();
  appendAgentLog(
    `Zoomed ROI ${state.selection.x},${state.selection.y} ${state.selection.width}x${state.selection.height}.`,
  );
  return true;
}

function screenPointInSelection(point) {
  if (!state.selection) return false;
  const image = state.compare.active ? compareScreenToImage(point) : screenToImage(point);
  return (
    image.x >= state.selection.x &&
    image.y >= state.selection.y &&
    image.x < state.selection.x + state.selection.width &&
    image.y < state.selection.y + state.selection.height
  );
}

function resizeCanvas() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function fitIfNeeded() {
  if (state.compare.active) {
    const { scale, offsetX, offsetY } = state.compare.view;
    if (!Number.isFinite(scale) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      fitToCanvas();
    }
    return;
  }
  if (!state.frame) return;
  const { scale, offsetX, offsetY } = state.viewport;
  if (!Number.isFinite(scale) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    fitToCanvas();
  }
}

function fitToCanvas() {
  if (state.compare.active) {
    fitCompareToCanvas();
    return;
  }
  if (!state.frame) return;
  resizeCanvas();
  const rect = els.canvas.getBoundingClientRect();
  const margin = 32;
  const scale = Math.min(
    (rect.width - margin) / state.frame.width,
    (rect.height - margin) / state.frame.height,
  );
  state.viewport.scale = Math.max(0.01, scale);
  state.viewport.offsetX = (rect.width - state.frame.width * state.viewport.scale) / 2;
  state.viewport.offsetY = (rect.height - state.frame.height * state.viewport.scale) / 2;
  updateViewState();
}

function draw() {
  resizeCanvas();
  const rect = els.canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawBackground(rect.width, rect.height);

  if (state.compare.active) {
    drawVideoCompare(rect);
    return;
  }

  if (!state.frame) return;

  const { scale, offsetX, offsetY } = state.viewport;
  ctx.imageSmoothingEnabled = scale < 4;
  ctx.drawImage(
    imageCanvas,
    offsetX,
    offsetY,
    state.frame.width * scale,
    state.frame.height * scale,
  );

  drawCandidateRegions();
  drawSelection();
  drawMarkers();
  drawPointer();
}

function drawBackground(width, height) {
  ctx.fillStyle = "#1f211e";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#282b27";
  const tile = 20;
  for (let y = 0; y < height; y += tile) {
    for (let x = (y / tile) % 2 === 0 ? 0 : tile; x < width; x += tile * 2) {
      ctx.fillRect(x, y, tile, tile);
    }
  }
}

function fitCompareToCanvas() {
  if (!state.compare.active) return;
  resizeCanvas();
  const rect = els.canvas.getBoundingClientRect();
  const tiles = computeCompareTileRects(rect.width, rect.height);
  const firstImageRect = tiles[0]?.imageRect;
  if (!firstImageRect) return;
  const margin = 18;
  const scale = Math.min(
    (firstImageRect.width - margin) / state.compare.width,
    (firstImageRect.height - margin) / state.compare.height,
  );
  state.compare.view.scale = Math.max(0.01, scale);
  state.compare.view.offsetX = (firstImageRect.width - state.compare.width * state.compare.view.scale) / 2;
  state.compare.view.offsetY = (firstImageRect.height - state.compare.height * state.compare.view.scale) / 2;
  updateViewState();
}

function drawVideoCompare(rect) {
  const compare = state.compare;
  if (!compare.videos.length) return;

  compare.tileRects = computeCompareTileRects(rect.width, rect.height);
  drawCompareTiles();
  drawCompareWorstRegions();
  drawCompareSelection();
  drawComparePointer();
}

function computeCompareTileRects(width, height) {
  const itemCount = state.compare.videos.length + 1;
  const columns = itemCount <= 3 ? 2 : Math.ceil(Math.sqrt(itemCount));
  const rows = Math.ceil(itemCount / columns);
  const gap = 12;
  const labelHeight = 24;
  const tileWidth = Math.max(1, (width - gap * (columns + 1)) / columns);
  const tileHeight = Math.max(1, (height - gap * (rows + 1)) / rows);
  const tiles = [];

  for (let index = 0; index < itemCount; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = gap + column * (tileWidth + gap);
    const y = gap + row * (tileHeight + gap);
    const isDiff = index === itemCount - 1;
    tiles.push({
      index,
      isDiff,
      x,
      y,
      width: tileWidth,
      height: tileHeight,
      imageRect: {
        x,
        y: y + labelHeight,
        width: tileWidth,
        height: Math.max(1, tileHeight - labelHeight),
      },
    });
  }

  return tiles;
}

function drawCompareTiles() {
  const compare = state.compare;
  ctx.save();
  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;

  for (const tile of compare.tileRects) {
    const label = compareTileLabel(tile);
    ctx.fillStyle = "#121411";
    ctx.strokeStyle = "#475045";
    ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
    ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, tile.width - 1, tile.height - 1);
    ctx.fillStyle = tile.isDiff ? "#f2b34c" : "#dce7dd";
    ctx.fillText(label, tile.x + 9, tile.y + 12);

    const source = tile.isDiff ? compareDiffCanvas : compare.frameCanvases[tile.index];
    if (!source) continue;
    const overlayTile = compare.overlayHold && !tile.isDiff && tile.index === compare.gtIndex;
    if (overlayTile) {
      drawCompareImageInTile(source, tile.imageRect);
      const overlaySource = compare.frameCanvases[compare.targetIndex];
      if (overlaySource) {
        ctx.save();
        ctx.globalAlpha = 0.72;
        drawCompareImageInTile(overlaySource, tile.imageRect);
        ctx.restore();
      }
      continue;
    }
    drawCompareImageInTile(source, tile.imageRect);
  }

  ctx.restore();
}

function drawCompareImageInTile(source, imageRect) {
  const { scale, offsetX, offsetY } = state.compare.view;
  ctx.save();
  ctx.beginPath();
  ctx.rect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = scale < 4;
  ctx.drawImage(
    source,
    imageRect.x + offsetX,
    imageRect.y + offsetY,
    state.compare.width * scale,
    state.compare.height * scale,
  );
  ctx.restore();
}

function compareTileLabel(tile) {
  if (tile.isDiff) {
    return `Diff ${compareLabel(state.compare.gtIndex)} -> ${compareLabel(state.compare.targetIndex)} (${compareDomainLabel(state.compare.domain)})`;
  }
  const track = state.compare.videos[tile.index];
  if (state.compare.overlayHold && tile.index === state.compare.gtIndex) {
    return `Overlay ${compareLabel(state.compare.gtIndex)} + ${compareLabel(state.compare.targetIndex)}: ${track?.name || "video"}`;
  }
  const role = tile.index === state.compare.gtIndex ? "GT" : compareLabel(tile.index);
  return `${role}: ${track?.name || "video"}`;
}

function updateCompareFramesAndLoss() {
  const compare = state.compare;
  if (!compare.active) return null;

  for (const [index, track] of compare.videos.entries()) {
    const context = compare.frameContexts[index];
    if (!context) continue;
    const source = compareTrackDrawable(track);
    if (source) context.drawImage(source, 0, 0, compare.width, compare.height);
  }

  compare.loss = computeCompareLoss();
  updateCompareInspector();
  return compare.loss;
}

function computeCompareLoss() {
  const compare = state.compare;
  if (compare.domain === "raw-bayer" && compareSupportsRawBayer()) {
    return computeRawBayerCompareLoss();
  }

  const gtCtx = compare.frameContexts[compare.gtIndex];
  const targetCtx = compare.frameContexts[compare.targetIndex];
  if (!gtCtx || !targetCtx) return null;

  const width = compare.width;
  const height = compare.height;
  const gt = gtCtx.getImageData(0, 0, width, height);
  const target = targetCtx.getImageData(0, 0, width, height);
  const output = compareDiffCtx.createImageData(width, height);
  const edgeGt = compare.metric === "edge-mae" ? computeLumaEdges(gt.data, width, height) : null;
  const edgeTarget = compare.metric === "edge-mae" ? computeLumaEdges(target.data, width, height) : null;
  const lossMap = new Float32Array(width * height);

  let maeSum = 0;
  let mseSum = 0;
  let maxValue = 0;
  const count = width * height;

  for (let pixel = 0; pixel < count; pixel += 1) {
    const i = pixel * 4;
    const dr = target.data[i] - gt.data[i];
    const dg = target.data[i + 1] - gt.data[i + 1];
    const db = target.data[i + 2] - gt.data[i + 2];
    const lumaDelta = luma(target.data[i], target.data[i + 1], target.data[i + 2])
      - luma(gt.data[i], gt.data[i + 1], gt.data[i + 2]);

    let value;
    if (compare.metric === "luma-mae") {
      value = Math.abs(lumaDelta);
    } else if (compare.metric === "rgb-mse") {
      value = Math.sqrt((dr * dr + dg * dg + db * db) / 3);
    } else if (compare.metric === "edge-mae") {
      value = Math.abs(edgeTarget[pixel] - edgeGt[pixel]);
    } else {
      value = (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3;
    }

    const normalized = clamp(value / 255, 0, 1);
    lossMap[pixel] = normalized;
    maeSum += normalized;
    mseSum += normalized * normalized;
    maxValue = Math.max(maxValue, normalized);
    writeDiffColor(output.data, i, normalized, lumaDelta / 255);
  }

  compareDiffCtx.putImageData(output, 0, 0);
  compare.lossMap = lossMap;
  const mae = maeSum / count;
  const mse = mseSum / count;
  const rmse = Math.sqrt(mse);
  const psnr = rmse > 0 ? 20 * Math.log10(1 / rmse) : Number.POSITIVE_INFINITY;

  return {
    gtIndex: compare.gtIndex,
    targetIndex: compare.targetIndex,
    domain: compare.domain,
    metric: compare.metric,
    gradient: compare.gradient,
    count,
    mae,
    mse,
    rmse,
    psnr,
    max: maxValue,
    time: compare.currentTime,
  };
}

function computeRawBayerCompareLoss() {
  const compare = state.compare;
  const gtTrack = compare.videos[compare.gtIndex];
  const targetTrack = compare.videos[compare.targetIndex];
  if (!gtTrack?.frame || !targetTrack?.frame) return null;

  const width = compare.width;
  const height = compare.height;
  const output = compareDiffCtx.createImageData(width, height);
  const lossMap = new Float32Array(width * height);
  const edgeGt = compare.metric === "edge-mae" ? computeRawEdges(gtTrack.frame, width, height) : null;
  const edgeTarget = compare.metric === "edge-mae" ? computeRawEdges(targetTrack.frame, width, height) : null;

  let maeSum = 0;
  let mseSum = 0;
  let maxValue = 0;
  const count = width * height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const outIndex = pixel * 4;
      const gtNorm = normalizeBayerPixel(gtTrack.frame, x, y);
      const targetNorm = normalizeBayerPixel(targetTrack.frame, x, y);
      const signed = targetNorm - gtNorm;
      const value = compare.metric === "edge-mae"
        ? Math.abs(edgeTarget[pixel] - edgeGt[pixel])
        : Math.abs(signed);
      const normalized = clamp(value, 0, 1);

      lossMap[pixel] = normalized;
      maeSum += normalized;
      mseSum += normalized * normalized;
      maxValue = Math.max(maxValue, normalized);
      writeDiffColor(output.data, outIndex, normalized, signed);
    }
  }

  compareDiffCtx.putImageData(output, 0, 0);
  compare.lossMap = lossMap;
  const mae = maeSum / count;
  const mse = mseSum / count;
  const rmse = Math.sqrt(mse);
  const psnr = rmse > 0 ? 20 * Math.log10(1 / rmse) : Number.POSITIVE_INFINITY;

  return {
    gtIndex: compare.gtIndex,
    targetIndex: compare.targetIndex,
    domain: compare.domain,
    metric: compare.metric,
    gradient: compare.gradient,
    count,
    mae,
    mse,
    rmse,
    psnr,
    max: maxValue,
    time: compare.currentTime,
  };
}

function computeRawEdges(frame, width, height) {
  const values = new Float32Array(width * height);
  const edges = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      values[y * width + x] = normalizeBayerPixel(frame, x, y);
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = values[index + 1] - values[index - 1];
      const dy = values[index + width] - values[index - width];
      edges[index] = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
    }
  }

  return edges;
}

function normalizeBayerPixel(frame, x, y) {
  const ix = clamp(Math.floor(x), 0, frame.width - 1);
  const iy = clamp(Math.floor(y), 0, frame.height - 1);
  const raw = frame.raw[iy * frame.width + ix];
  return normalizeRawValue(raw, frame.blackLevel ?? 0, displayWhiteLevel(frame.bitDepth));
}

function computeImageDataLoss(gtData, targetData, count, metric) {
  let maeSum = 0;
  let mseSum = 0;
  let maxValue = 0;

  for (let pixel = 0; pixel < count; pixel += 1) {
    const i = pixel * 4;
    const dr = targetData[i] - gtData[i];
    const dg = targetData[i + 1] - gtData[i + 1];
    const db = targetData[i + 2] - gtData[i + 2];
    const lumaDelta = luma(targetData[i], targetData[i + 1], targetData[i + 2])
      - luma(gtData[i], gtData[i + 1], gtData[i + 2]);

    let value;
    if (metric === "luma-mae" || metric === "edge-mae") {
      value = Math.abs(lumaDelta);
    } else if (metric === "rgb-mse") {
      value = Math.sqrt((dr * dr + dg * dg + db * db) / 3);
    } else {
      value = (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3;
    }

    const normalized = clamp(value / 255, 0, 1);
    maeSum += normalized;
    mseSum += normalized * normalized;
    maxValue = Math.max(maxValue, normalized);
  }

  const mae = count ? maeSum / count : 0;
  const mse = count ? mseSum / count : 0;
  const rmse = Math.sqrt(mse);
  const psnr = rmse > 0 ? 20 * Math.log10(1 / rmse) : Number.POSITIVE_INFINITY;
  return { count, mae, mse, rmse, psnr, max: maxValue };
}

function computeLumaEdges(data, width, height) {
  const edges = new Float32Array(width * height);
  const lumas = new Float32Array(width * height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const i = pixel * 4;
    lumas[pixel] = luma(data[i], data[i + 1], data[i + 2]);
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = lumas[index + 1] - lumas[index - 1];
      const dy = lumas[index + width] - lumas[index - width];
      edges[index] = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
    }
  }

  return edges;
}

function writeDiffColor(output, i, normalized, signedLuma) {
  if (state.compare.gradient === "gray") {
    const gray = Math.round(normalized * 255);
    output[i] = gray;
    output[i + 1] = gray;
    output[i + 2] = gray;
    output[i + 3] = 255;
    return;
  }

  if (state.compare.gradient === "signed") {
    const strength = Math.round(clamp(Math.abs(signedLuma), 0, 1) * 255);
    output[i] = signedLuma >= 0 ? strength : 32;
    output[i + 1] = Math.max(0, 96 - Math.round(strength * 0.25));
    output[i + 2] = signedLuma < 0 ? strength : 32;
    output[i + 3] = 255;
    return;
  }

  const t = Math.sqrt(normalized);
  output[i] = Math.round(255 * clamp(t * 1.6, 0, 1));
  output[i + 1] = Math.round(255 * clamp((t - 0.25) * 1.45, 0, 1));
  output[i + 2] = Math.round(80 * (1 - t));
  output[i + 3] = 255;
}

function drawComparePointer() {
  if (!state.pointer || !state.compare.active) return;
  const image = compareScreenToImage(state.pointer);
  if (!compareInBounds(image.x, image.y)) return;

  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1;
  for (const tile of state.compare.tileRects) {
    const pt = compareImageToScreen({ x: Math.floor(image.x) + 0.5, y: Math.floor(image.y) + 0.5 }, tile);
    ctx.beginPath();
    ctx.moveTo(pt.x - 9, pt.y);
    ctx.lineTo(pt.x + 9, pt.y);
    ctx.moveTo(pt.x, pt.y - 9);
    ctx.lineTo(pt.x, pt.y + 9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCompareSelection() {
  if (!state.selection || !state.compare.active) return;
  ctx.save();
  ctx.strokeStyle = "#77d4aa";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);

  for (const tile of state.compare.tileRects) {
    const a = compareImageToScreen(state.selection, tile);
    const b = compareImageToScreen(
      {
        x: state.selection.x + state.selection.width,
        y: state.selection.y + state.selection.height,
      },
      tile,
    );
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  ctx.restore();
}

function drawCompareWorstRegions() {
  if (!state.compare.worstRegions.length || !state.compare.active) return;
  ctx.save();
  ctx.strokeStyle = "#f2b34c";
  ctx.fillStyle = "#f2b34c";
  ctx.font = "12px system-ui, sans-serif";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);

  for (const [index, region] of state.compare.worstRegions.entries()) {
    for (const tile of state.compare.tileRects) {
      const a = compareImageToScreen(region, tile);
      const b = compareImageToScreen(
        {
          x: region.x + region.width,
          y: region.y + region.height,
        },
        tile,
      );
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      if (tile.isDiff) {
        ctx.fillText(`W${index + 1} ${formatFloat(region.score)}`, a.x + 5, Math.max(tile.imageRect.y + 12, a.y + 14));
      }
    }
  }

  ctx.restore();
}

function zoomCompareAt(screenPoint, factor) {
  if (!state.compare.active) return;
  const before = compareScreenToImage(screenPoint);
  state.compare.view.scale = clamp(state.compare.view.scale * factor, 0.05, 64);
  const tile = compareTileAt(screenPoint) || state.compare.tileRects[0];
  if (!tile) return;
  const imageRect = tile.imageRect;
  state.compare.view.offsetX = screenPoint.x - imageRect.x - before.x * state.compare.view.scale;
  state.compare.view.offsetY = screenPoint.y - imageRect.y - before.y * state.compare.view.scale;
  updateViewState();
  draw();
}

function compareScreenToImage(point) {
  const tile = compareTileAt(point) || state.compare.tileRects[0];
  if (!tile) return { x: 0, y: 0 };
  return {
    x: (point.x - tile.imageRect.x - state.compare.view.offsetX) / state.compare.view.scale,
    y: (point.y - tile.imageRect.y - state.compare.view.offsetY) / state.compare.view.scale,
  };
}

function compareImageToScreen(point, tile = state.compare.tileRects[0]) {
  return {
    x: tile.imageRect.x + state.compare.view.offsetX + point.x * state.compare.view.scale,
    y: tile.imageRect.y + state.compare.view.offsetY + point.y * state.compare.view.scale,
  };
}

function compareTileAt(point) {
  return state.compare.tileRects.find(
    (tile) =>
      point.x >= tile.imageRect.x &&
      point.y >= tile.imageRect.y &&
      point.x < tile.imageRect.x + tile.imageRect.width &&
      point.y < tile.imageRect.y + tile.imageRect.height,
  );
}

function drawMarkers() {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#f2b34c";
  ctx.fillStyle = "#f2b34c";
  ctx.font = "12px system-ui, sans-serif";
  for (const marker of state.markers) {
    const pt = imageToScreen(marker);
    ctx.beginPath();
    ctx.moveTo(pt.x - 8, pt.y);
    ctx.lineTo(pt.x + 8, pt.y);
    ctx.moveTo(pt.x, pt.y - 8);
    ctx.lineTo(pt.x, pt.y + 8);
    ctx.stroke();
    if (marker.label) ctx.fillText(marker.label, pt.x + 10, pt.y - 10);
  }
  ctx.restore();
}

function drawCandidateRegions() {
  if (!state.candidateRegions.length) return;

  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#f2b34c";
  ctx.fillStyle = "#f2b34c";
  ctx.font = "12px system-ui, sans-serif";
  ctx.setLineDash([5, 4]);

  for (const candidate of state.candidateRegions) {
    const a = imageToScreen(candidate);
    const b = imageToScreen({
      x: candidate.x + candidate.width,
      y: candidate.y + candidate.height,
    });
    const label = Number.isFinite(candidate.score)
      ? `${candidate.label} ${formatFloat(candidate.score)}`
      : candidate.label;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fillText(
      label,
      a.x + 6,
      Math.max(14, a.y + 15),
    );
  }

  ctx.restore();
}

function drawSelection() {
  if (!state.selection) return;
  const a = imageToScreen(state.selection);
  const b = imageToScreen({
    x: state.selection.x + state.selection.width,
    y: state.selection.y + state.selection.height,
  });
  ctx.save();
  ctx.strokeStyle = "#77d4aa";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}

function drawPointer() {
  if (state.compare.active) {
    drawComparePointer();
    return;
  }
  if (!state.pointer || !state.frame) return;
  const image = screenToImage(state.pointer);
  if (!inBounds(image.x, image.y)) return;
  const pt = imageToScreen({ x: Math.floor(image.x) + 0.5, y: Math.floor(image.y) + 0.5 });
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pt.x - 9, pt.y);
  ctx.lineTo(pt.x + 9, pt.y);
  ctx.moveTo(pt.x, pt.y - 9);
  ctx.lineTo(pt.x, pt.y + 9);
  ctx.stroke();
  ctx.restore();
}

function updatePointer(point) {
  state.pointer = point;
  updatePixelInspector(getPixelFromScreenPoint(point));
  draw();
}

function getPixelFromScreenPoint(point) {
  if (state.compare.active) {
    return getComparePixelFromScreenPoint(point);
  }
  const image = screenToImage(point);
  return getPixel({ x: Math.floor(image.x), y: Math.floor(image.y) });
}

function zoomAroundCenter(factor) {
  const rect = els.canvas.getBoundingClientRect();
  zoomAt({ x: rect.width / 2, y: rect.height / 2 }, factor);
}

function zoomAt(screenPoint, factor) {
  if (state.compare.active) {
    zoomCompareAt(screenPoint, factor);
    return;
  }
  if (!state.frame) return;
  const before = screenToImage(screenPoint);
  state.viewport.scale = clamp(state.viewport.scale * factor, 0.05, 64);
  state.viewport.offsetX = screenPoint.x - before.x * state.viewport.scale;
  state.viewport.offsetY = screenPoint.y - before.y * state.viewport.scale;
  updateViewState();
  draw();
}

function imageToScreen({ x, y }) {
  return {
    x: state.viewport.offsetX + x * state.viewport.scale,
    y: state.viewport.offsetY + y * state.viewport.scale,
  };
}

function screenToImage({ x, y }) {
  return {
    x: (x - state.viewport.offsetX) / state.viewport.scale,
    y: (y - state.viewport.offsetY) / state.viewport.scale,
  };
}

function eventToCanvasPoint(event) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getPixel({ x, y }) {
  if (!state.frame || !inBounds(x, y)) return null;
  const ix = Math.floor(x);
  const iy = Math.floor(y);

  if (state.frame.kind === "bayer-frame") {
    const index = iy * state.frame.width + ix;
    const raw = state.frame.raw[index];
    const plane = cfaPlaneAt(state.bayerPattern, ix, iy);
    const whiteLevel = displayWhiteLevel(state.inputBitDepth);
    const normalized = normalizeRawValue(raw, state.frame.blackLevel, whiteLevel);
    return {
      x: ix,
      y: iy,
      kind: state.frame.kind,
      raw,
      normalized,
      cfa: plane,
      bayerPattern: state.bayerPattern,
      inputBitDepth: state.inputBitDepth,
      whiteBalanceGain: getPlaneGain(plane, expandedWhiteBalance()),
    };
  }

  const index = (iy * state.frame.width + ix) * 3;
  const r = state.frame.rgb[index];
  const g = state.frame.rgb[index + 1];
  const b = state.frame.rgb[index + 2];
  return {
    x: ix,
    y: iy,
    kind: state.frame.kind,
    rgb: [r, g, b],
    luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
  };
}

function getPatch(region) {
  const roi = normalizeRoi(region);
  const values = [];
  if (!state.frame) return { ...roi, values };

  const maxSamples = Number(region.maxSamples ?? 256);
  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const pixel = getPixel({ x, y });
      if (pixel) values.push(pixel);
      if (values.length >= maxSamples) {
        return { ...roi, truncated: true, values };
      }
    }
  }
  return { ...roi, truncated: false, values };
}

function getRoiStats(region) {
  const roi = normalizeRoi(region);
  if (!state.frame) return { ...roi, count: 0 };
  if (state.frame.kind === "bayer-frame") {
    return getBayerRoiStats(roi);
  }
  return getHdrRoiStats(roi);
}

function getBayerRoiStats(roi) {
  const perPlane = {
    R: makeAccumulator(),
    Gr: makeAccumulator(),
    Gb: makeAccumulator(),
    B: makeAccumulator(),
  };
  const total = makeAccumulator();
  const whiteLevel = displayWhiteLevel(state.inputBitDepth);

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const index = y * state.frame.width + x;
      const raw = state.frame.raw[index];
      const normalized = normalizeRawValue(raw, state.frame.blackLevel, whiteLevel);
      accumulate(total, raw, normalized);
      accumulate(perPlane[cfaPlaneAt(state.bayerPattern, x, y)], raw, normalized);
    }
  }

  return {
    ...roi,
    inputBitDepth: state.inputBitDepth,
    whiteLevel,
    count: total.count,
    raw: finishAccumulator(total),
    perPlane: Object.fromEntries(
      Object.entries(perPlane).map(([plane, accumulator]) => [
        plane,
        finishAccumulator(accumulator),
      ]),
    ),
  };
}

function getHdrRoiStats(roi) {
  let count = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let luma = 0;
  let minLuma = Number.POSITIVE_INFINITY;
  let maxLuma = 0;

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const pixel = getPixel({ x, y });
      if (!pixel) continue;
      count += 1;
      r += pixel.rgb[0];
      g += pixel.rgb[1];
      b += pixel.rgb[2];
      luma += pixel.luminance;
      minLuma = Math.min(minLuma, pixel.luminance);
      maxLuma = Math.max(maxLuma, pixel.luminance);
    }
  }

  return {
    ...roi,
    count,
    meanRgb: count ? [r / count, g / count, b / count] : [0, 0, 0],
    meanLuminance: count ? luma / count : 0,
    minLuminance: count ? minLuma : 0,
    maxLuminance: count ? maxLuma : 0,
  };
}

function updateCompareFrameInspector() {
  els.sourceName.textContent = state.sourceName || "-";
  const kinds = new Set(state.compare.videos.map((track) => track.kind));
  const isBayer = kinds.size === 1 && kinds.has("bayer-frame");
  const isVideo = kinds.size === 1 && kinds.has("video");
  els.frameKind.textContent = isBayer ? "bayer-compare" : isVideo ? "video-compare" : "source-compare";
  els.frameSize.textContent = `${state.compare.width} x ${state.compare.height}`;
  els.frameBits.textContent = isBayer
    ? `${[...new Set(state.compare.videos.map((track) => track.frame.bitDepth))].join("/")} raw`
    : "8-bit decoded RGB";
  els.framePattern.textContent = isBayer
    ? [...new Set(state.compare.videos.map((track) => track.frame.bayerPattern))].join("/")
    : "-";
  els.statP50.textContent = "-";
  els.statP95.textContent = "-";
  els.statP99.textContent = "-";
  els.statMax.textContent = state.compare.loss ? formatFloat(state.compare.loss.max) : "-";
  updateViewState();
}

function updateCompareInspector() {
  if (!state.compare.active) {
    els.compareVideoCount.textContent = "-";
    els.compareMae.textContent = "-";
    els.compareRmse.textContent = "-";
    els.comparePsnr.textContent = "-";
    els.compareRoi.textContent = "-";
    els.compareRoiMae.textContent = "-";
    els.compareRoiPsnr.textContent = "-";
    els.compareWorstTime.textContent = "-";
    return;
  }
  updateCompareFrameInspector();
  els.compareVideoCount.textContent = `${state.compare.videos.length} @ ${state.compare.width}x${state.compare.height} / ${compareDomainLabel(state.compare.domain)}`;
  els.compareMae.textContent = state.compare.loss ? formatFloat(state.compare.loss.mae) : "-";
  els.compareRmse.textContent = state.compare.loss ? formatFloat(state.compare.loss.rmse) : "-";
  els.comparePsnr.textContent = state.compare.loss ? formatPsnr(state.compare.loss.psnr) : "-";

  const roiLoss = state.selection ? getCompareRoiLossNoRefresh(state.selection) : null;
  els.compareRoi.textContent = state.selection
    ? `${state.selection.x},${state.selection.y} ${state.selection.width}x${state.selection.height}`
    : "-";
  els.compareRoiMae.textContent = roiLoss ? formatFloat(roiLoss.mae) : "-";
  els.compareRoiPsnr.textContent = roiLoss ? formatPsnr(roiLoss.psnr) : "-";
  const worstTime = state.compare.worstTimes[0];
  els.compareWorstTime.textContent = worstTime
    ? `${formatSeconds(worstTime.time)}s / ${formatFloat(worstTime.mae)}`
    : "-";
}

function updateTe42AnalysisInspector() {
  const analysis = state.te42Analysis;
  if (!analysis) {
    els.te42Snr.textContent = "-";
    els.te42GreenDiff.textContent = "-";
    els.te42MtfStar.textContent = "-";
    els.te42MtfHorizontal.textContent = "-";
    els.te42MtfVertical.textContent = "-";
    els.te42FlatCount.textContent = "-";
    els.te42Status.textContent = isTe42SourceName() ? "Ready" : "-";
    return;
  }

  els.te42Snr.textContent = `${formatDb(analysis.snr.medianDb)} med / ${formatDb(analysis.snr.bestDb)} best`;
  els.te42GreenDiff.textContent = `${formatPercent(analysis.greenDiff.diffPct)} (${formatFloat(analysis.greenDiff.diffDn)} DN)`;
  els.te42MtfStar.textContent = formatMtf(analysis.mtf.star?.mtf50, analysis.mtf.star?.censored);
  els.te42MtfHorizontal.textContent = formatMtf(analysis.mtf.horizontal?.mtf50);
  els.te42MtfVertical.textContent = formatMtf(analysis.mtf.vertical?.mtf50);
  els.te42FlatCount.textContent = String(analysis.flatPatches.length);
  els.te42Status.textContent = `${Math.round(analysis.confidence * 100)}% confidence`;
}

function getComparePixelFromScreenPoint(point) {
  const image = compareScreenToImage(point);
  return getPixelCompare({ x: Math.floor(image.x), y: Math.floor(image.y) });
}

function getPixelCompare({ x, y }) {
  if (!state.compare.active || !compareInBounds(x, y)) return null;
  updateCompareFramesAndLoss();

  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const samples = state.compare.frameContexts.map((context, index) => {
    const track = state.compare.videos[index];
    const data = context.getImageData(ix, iy, 1, 1).data;
    const rgb = [data[0], data[1], data[2]];
    const sample = {
      label: compareLabel(index),
      index,
      kind: track?.kind || "video",
      rgb,
      luma: luma(rgb[0], rgb[1], rgb[2]),
    };
    if (track?.kind === "bayer-frame") {
      const rawIndex = iy * track.frame.width + ix;
      sample.raw = track.frame.raw[rawIndex];
      sample.normalized = normalizeBayerPixel(track.frame, ix, iy);
      sample.cfa = cfaPlaneAt(track.frame.bayerPattern, ix, iy);
    }
    return sample;
  });
  const gt = samples[state.compare.gtIndex];
  const target = samples[state.compare.targetIndex];
  const lossMapValue = state.compare.lossMap?.[iy * state.compare.width + ix];
  const loss = state.compare.domain === "raw-bayer" && gt?.normalized != null && target?.normalized != null
    ? Math.abs(target.normalized - gt.normalized)
    : Math.abs(target.luma - gt.luma);

  return {
    kind: "compare",
    x: ix,
    y: iy,
    gtIndex: state.compare.gtIndex,
    targetIndex: state.compare.targetIndex,
    domain: state.compare.domain,
    samples,
    loss,
    normalizedLoss: Number.isFinite(lossMapValue)
      ? lossMapValue
      : state.compare.domain === "raw-bayer"
        ? loss
        : loss / 255,
    metric: state.compare.metric,
  };
}

function compareInBounds(x, y) {
  return (
    state.compare.active &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x < state.compare.width &&
    y < state.compare.height
  );
}

function normalizeCompareRoi(region) {
  const x = clamp(Math.floor(Number(region.x) || 0), 0, state.compare.width);
  const y = clamp(Math.floor(Number(region.y) || 0), 0, state.compare.height);
  const width = clamp(Math.floor(Number(region.width) || 1), 0, state.compare.width - x);
  const height = clamp(Math.floor(Number(region.height) || 1), 0, state.compare.height - y);
  return { x, y, width, height };
}

function normalizeCompareRoiFromCorners(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);
  return normalizeCompareRoi({
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  });
}

function makeAccumulator() {
  return {
    count: 0,
    rawSum: 0,
    normSum: 0,
    rawMin: Number.POSITIVE_INFINITY,
    rawMax: 0,
  };
}

function accumulate(accumulator, raw, normalized) {
  accumulator.count += 1;
  accumulator.rawSum += raw;
  accumulator.normSum += normalized;
  accumulator.rawMin = Math.min(accumulator.rawMin, raw);
  accumulator.rawMax = Math.max(accumulator.rawMax, raw);
}

function finishAccumulator(accumulator) {
  return {
    count: accumulator.count,
    min: accumulator.count ? accumulator.rawMin : 0,
    max: accumulator.count ? accumulator.rawMax : 0,
    mean: accumulator.count ? accumulator.rawSum / accumulator.count : 0,
    normalizedMean: accumulator.count ? accumulator.normSum / accumulator.count : 0,
  };
}

function normalizeRoi(region) {
  if (!state.frame) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const x = clamp(Math.floor(Number(region.x) || 0), 0, state.frame.width);
  const y = clamp(Math.floor(Number(region.y) || 0), 0, state.frame.height);
  const width = clamp(Math.floor(Number(region.width) || 1), 0, state.frame.width - x);
  const height = clamp(Math.floor(Number(region.height) || 1), 0, state.frame.height - y);
  return { x, y, width, height };
}

function inBounds(x, y) {
  return (
    state.frame &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x < state.frame.width &&
    y < state.frame.height
  );
}

function syncControls() {
  els.viewModeSelect.value = state.viewMode;
  els.bitDepthInput.value = String(state.inputBitDepth);
  els.bayerPatternSelect.value = state.bayerPattern;
  els.wbRInput.value = formatControlNumber(state.wbGains.r);
  els.wbGInput.value = formatControlNumber(state.wbGains.g);
  els.wbBInput.value = formatControlNumber(state.wbGains.b);
  els.exposureInput.value = String(state.tone.exposureEv);
  els.gammaInput.value = formatControlNumber(state.tone.gamma);
  updateExposureOutput();

  const isBayer = state.frame?.kind === "bayer-frame";
  els.bitDepthInput.disabled = !isBayer;
  els.bayerPatternSelect.disabled = !isBayer;
  for (const option of els.viewModeSelect.options) {
    option.disabled = !isBayer && option.value !== "demosaic-preview";
  }
}

function syncCompareControls() {
  const active = state.compare.active;
  const hasTimeline = active && compareTracksHaveTimeline();
  if (!active) {
    state.compare.overlayHold = false;
  }
  const controls = [
    document.querySelector('[data-agent-action="toggle-compare-roi"]'),
    document.querySelector('[data-agent-action="hold-compare-overlay"]'),
    document.querySelector('[data-agent-action="find-worst-compare-roi"]'),
    els.compareGtSelect,
    els.compareTargetSelect,
    els.compareDomainSelect,
    els.compareMetricSelect,
    els.compareGradientSelect,
  ];

  for (const control of controls) {
    if (control) control.disabled = !active;
  }

  const timelineControls = [
    document.querySelector('[data-agent-action="toggle-video-playback"]'),
    document.querySelector('[data-agent-action="find-worst-compare-time"]'),
    els.compareTimeInput,
  ];

  for (const control of timelineControls) {
    if (control) control.disabled = !hasTimeline;
  }

  if (els.compareDomainSelect) {
    for (const option of els.compareDomainSelect.options) {
      option.disabled = option.value === "raw-bayer" && !compareSupportsRawBayer();
    }
  }

  els.comparePlayLabel.textContent = state.compare.playing ? "Pause" : "Play";
  els.compareRoiModeLabel.textContent = state.compare.roiMode ? "ROI On" : "ROI Drag";
  els.compareOverlayLabel.textContent = state.compare.overlayHold
    ? `${compareLabel(state.compare.gtIndex)} + ${compareLabel(state.compare.targetIndex)}`
    : `Hold ${compareLabel(state.compare.targetIndex)}`;
  state.compare.domain = sanitizeCompareDomain(state.compare.domain);
  els.compareDomainSelect.value = state.compare.domain;
  els.compareMetricSelect.value = state.compare.metric;
  els.compareGradientSelect.value = state.compare.gradient;

  fillCompareSelect(els.compareGtSelect, state.compare.gtIndex, true);
  fillCompareSelect(els.compareTargetSelect, state.compare.targetIndex, false);
  syncCompareTimeControls();
}

function fillCompareSelect(select, selectedIndex, allowGt) {
  select.innerHTML = "";
  for (const [index, track] of state.compare.videos.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${compareLabel(index)} ${track.name}`;
    option.disabled = !allowGt && index === state.compare.gtIndex;
    select.append(option);
  }
  select.value = String(selectedIndex);
}

function syncCompareTimeControls() {
  els.compareTimeInput.max = String(state.compare.duration || 0);
  els.compareTimeInput.value = String(state.compare.currentTime || 0);
  els.compareTimeValue.textContent = `${formatSeconds(state.compare.currentTime)}s`;
  els.compareDurationValue.textContent = `${formatSeconds(state.compare.duration)}s`;
}

function updateFrameInspector() {
  if (state.compare.active) {
    updateCompareFrameInspector();
    return;
  }
  if (!state.frame) return;
  els.sourceName.textContent = state.sourceName;
  els.frameKind.textContent = state.frame.kind;
  els.frameSize.textContent = `${state.frame.width} x ${state.frame.height}`;
  els.frameBits.textContent =
    state.frame.kind === "bayer-frame"
      ? `${state.inputBitDepth} input (${state.frame.bitDepth} metadata)`
      : "-";
  els.framePattern.textContent = state.frame.kind === "bayer-frame" ? state.bayerPattern : "-";
  els.statP50.textContent = formatFloat(state.frame.stats.p50);
  els.statP95.textContent = formatFloat(state.frame.stats.p95);
  els.statP99.textContent = formatFloat(state.frame.stats.p99);
  els.statMax.textContent = formatFloat(state.frame.stats.max);
  updateViewState();
}

function updateViewState() {
  if (state.compare.active) {
    els.viewState.textContent = `compare, ${state.compare.view.scale.toFixed(2)}x`;
    return;
  }
  els.viewState.textContent = `${state.viewMode}, ${state.viewport.scale.toFixed(2)}x`;
}

function updatePixelInspector(pixel) {
  if (!pixel) {
    els.pixelXY.textContent = "-";
    els.pixelCfa.textContent = "-";
    els.pixelRaw.textContent = "-";
    els.pixelNorm.textContent = "-";
    els.pixelRGB.textContent = "-";
    els.pixelLuma.textContent = "-";
    return;
  }

  els.pixelXY.textContent = `${pixel.x}, ${pixel.y}`;

  if (pixel.kind === "compare" || pixel.kind === "video-compare") {
    els.pixelCfa.textContent = `${compareLabel(pixel.gtIndex)} -> ${compareLabel(pixel.targetIndex)} ${compareDomainLabel(pixel.domain)}`;
    els.pixelRaw.textContent = pixel.samples.some((sample) => sample.raw != null)
      ? pixel.samples
          .map((sample) => `${sample.label}:${sample.raw ?? "-"}${sample.cfa ? `(${sample.cfa})` : ""}`)
          .join("  ")
      : `loss ${formatFloat(pixel.loss)}`;
    els.pixelNorm.textContent = formatFloat(pixel.normalizedLoss);
    els.pixelRGB.textContent = pixel.samples
      .map((sample) => `${sample.label}:${sample.rgb.map((value) => Math.round(value)).join("/")}`)
      .join("  ");
    els.pixelLuma.textContent = pixel.samples
      .map((sample) => `${sample.label}:${formatFloat(sample.luma)}`)
      .join("  ");
    return;
  }

  if (pixel.kind === "bayer-frame") {
    els.pixelCfa.textContent = `${pixel.cfa} x${formatControlNumber(pixel.whiteBalanceGain)}`;
    els.pixelRaw.textContent = String(pixel.raw);
    els.pixelNorm.textContent = formatFloat(pixel.normalized);
    els.pixelRGB.textContent = "-";
    els.pixelLuma.textContent = "-";
    return;
  }

  els.pixelCfa.textContent = "-";
  els.pixelRaw.textContent = "-";
  els.pixelNorm.textContent = "-";
  els.pixelRGB.textContent = pixel.rgb.map(formatFloat).join(", ");
  els.pixelLuma.textContent = formatFloat(pixel.luminance);
}

function updateExposureOutput() {
  els.exposureValue.textContent = `${formatMultiplier(2 ** Number(state.tone.exposureEv))}x`;
}

function setStatus(text) {
  els.statusBadge.textContent = text;
  els.statusBadge.dataset.state = text.toLowerCase().replace(/\s+/g, "-");
}

function handleLoadError(error) {
  console.error(error);
  setStatus("Load failed");
}

function handleAgentError(error) {
  console.error(error);
  appendAgentLog(`Error: ${error.message}`);
  setStatus("Agent failed");
}

function setAgentLog(lines) {
  els.agentLog.innerHTML = "";
  for (const line of lines) {
    appendAgentLog(line);
  }
}

function appendAgentLog(text) {
  const item = document.createElement("li");
  item.textContent = text;
  els.agentLog.append(item);
  item.scrollIntoView({ block: "nearest" });
}

function loadSavedRegions() {
  try {
    const raw = window.localStorage?.getItem(SAVED_REGIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedRegionRecord).slice(0, 80);
  } catch (error) {
    console.warn("Could not load saved regions.", error);
    return [];
  }
}

function isSavedRegionRecord(record) {
  return Boolean(
    record &&
      typeof record.id === "string" &&
      record.region &&
      Number.isFinite(Number(record.region.x)) &&
      Number.isFinite(Number(record.region.y)) &&
      Number.isFinite(Number(record.region.width)) &&
      Number.isFinite(Number(record.region.height)),
  );
}

function persistSavedRegions() {
  try {
    window.localStorage?.setItem(SAVED_REGIONS_STORAGE_KEY, JSON.stringify(state.savedRegions));
  } catch (error) {
    console.warn("Could not persist saved regions.", error);
  }
}

function createRegionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `roi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveCurrentRegion(options = {}) {
  if (!state.selection) {
    throw new Error("Select an ROI before saving.");
  }
  return saveRegion(state.selection, options);
}

function saveRegion(region, options = {}) {
  const mode = options.mode || (state.compare.active ? "compare" : "image");
  const normalized = mode === "compare" ? normalizeCompareRoi(region) : normalizeRoi(region);
  if (!normalized.width || !normalized.height) {
    throw new Error("Cannot save an empty ROI.");
  }
  const saved = {
    id: options.id || createRegionId(),
    createdAt: new Date().toISOString(),
    mode,
    coordinateBasis: "image-pixel",
    label: String(options.label || defaultSavedRegionLabel(mode)).trim(),
    description: String(options.description ?? "").trim(),
    sourceName: String(options.sourceName || state.sourceName || ""),
    region: normalized,
    frame: savedRegionFrameContext(mode),
    compare: mode === "compare" ? savedRegionCompareContext(normalized) : null,
  };
  state.savedRegions = [
    saved,
    ...state.savedRegions.filter((item) => item.id !== saved.id),
  ].slice(0, 80);
  persistSavedRegions();
  syncSavedRegionList();
  return cloneSavedRegion(saved);
}

function defaultSavedRegionLabel(mode) {
  return mode === "compare" ? `Compare ROI ${state.savedRegions.length + 1}` : `ROI ${state.savedRegions.length + 1}`;
}

function savedRegionFrameContext(mode) {
  if (mode === "compare") {
    return {
      kind: "source-compare",
      width: state.compare.width,
      height: state.compare.height,
      sourceCount: state.compare.videos.length,
    };
  }
  return state.frame
    ? {
        kind: state.frame.kind,
        width: state.frame.width,
        height: state.frame.height,
        bitDepth: state.frame.bitDepth,
        bayerPattern: state.frame.kind === "bayer-frame" ? state.bayerPattern : null,
        inputBitDepth: state.frame.kind === "bayer-frame" ? state.inputBitDepth : null,
      }
    : null;
}

function savedRegionCompareContext(region = state.selection) {
  if (!state.compare.active) return null;
  return {
    gtIndex: state.compare.gtIndex,
    targetIndex: state.compare.targetIndex,
    domain: state.compare.domain,
    metric: state.compare.metric,
    gradient: state.compare.gradient,
    time: state.compare.currentTime,
    loss: region ? getCompareRoiLossNoRefresh(region) : null,
  };
}

function getSavedRegions() {
  return state.savedRegions.map(cloneSavedRegion);
}

function cloneSavedRegion(region) {
  return JSON.parse(JSON.stringify(region));
}

function deleteSavedRegion(id) {
  const before = state.savedRegions.length;
  state.savedRegions = state.savedRegions.filter((region) => region.id !== id);
  if (state.savedRegions.length !== before) {
    persistSavedRegions();
    syncSavedRegionList();
  }
  return getSavedRegions();
}

function clearSavedRegions() {
  state.savedRegions = [];
  persistSavedRegions();
  syncSavedRegionList();
  return [];
}

async function focusSavedRegion(id) {
  const saved = state.savedRegions.find((region) => region.id === id);
  if (!saved) {
    throw new Error(`Saved region not found: ${id}`);
  }
  if (saved.mode === "compare") {
    if (!state.compare.active) {
      throw new Error("Open compare mode before focusing this saved compare ROI.");
    }
    state.selection = normalizeCompareRoi(saved.region);
  } else {
    if (!state.frame) {
      throw new Error("Open an image before focusing this saved ROI.");
    }
    state.selection = normalizeRoi(saved.region);
  }
  updateRegionInspectors();
  draw();
  await focusSelectedRegion();
  appendAgentLog(`Focused saved region ${saved.label}: ${saved.region.x},${saved.region.y} ${saved.region.width}x${saved.region.height}.`);
  return cloneSavedRegion(saved);
}

function syncSavedRegionList() {
  if (!els.savedRegionList) return;
  els.savedRegionCount.textContent = String(state.savedRegions.length);
  els.savedRegionList.innerHTML = "";

  if (!state.savedRegions.length) {
    const empty = document.createElement("li");
    empty.className = "saved-region-empty";
    empty.textContent = "No saved regions";
    els.savedRegionList.append(empty);
    return;
  }

  for (const region of state.savedRegions) {
    const item = document.createElement("li");
    item.className = "saved-region-item";
    item.dataset.savedRegionId = region.id;

    const main = document.createElement("div");
    main.className = "saved-region-main";

    const title = document.createElement("strong");
    title.textContent = region.label || region.id;
    main.append(title);

    const meta = document.createElement("span");
    meta.textContent = savedRegionMeta(region);
    main.append(meta);

    if (region.description) {
      const description = document.createElement("p");
      description.textContent = region.description;
      main.append(description);
    }

    const actions = document.createElement("div");
    actions.className = "saved-region-actions";
    actions.append(makeSavedRegionButton(region.id, "focus", "Focus"));
    actions.append(makeSavedRegionButton(region.id, "delete", "Del"));

    item.append(main, actions);
    els.savedRegionList.append(item);
  }
}

function makeSavedRegionButton(id, action, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = action === "delete" ? "saved-region-button danger" : "saved-region-button";
  button.dataset.agentAction = `${action}-saved-region`;
  button.dataset.savedRegionId = id;
  button.dataset.savedAction = action;
  button.textContent = label;
  return button;
}

function savedRegionMeta(region) {
  const roi = region.region;
  const prefix = region.mode === "compare" ? "compare" : "image";
  const compare = region.compare
    ? ` ${compareLabel(region.compare.gtIndex)}->${compareLabel(region.compare.targetIndex)} ${compareDomainLabel(region.compare.domain)}`
    : "";
  return `${prefix}${compare} ${roi.x},${roi.y} ${roi.width}x${roi.height}`;
}

function updateRegionInspectors() {
  if (state.compare.active) {
    updateCompareInspector();
  }
}

function observeViewer(options = {}) {
  const stateSnapshot = getState();
  const observation = {
    timestamp: new Date().toISOString(),
    status: els.statusBadge.textContent,
    state: stateSnapshot,
    visibleImageRect: getVisibleImageRect(),
    selectedRegion: state.selection ? { ...state.selection } : null,
    selectedRegionStats: null,
    selectedRegionCompareLoss: null,
    summary: {
      sourceName: state.sourceName,
      mode: state.mode,
      viewMode: state.viewMode,
      frameKind: state.frame?.kind || null,
      frameSize: state.frame ? { width: state.frame.width, height: state.frame.height } : null,
      compareActive: state.compare.active,
      markerCount: state.markers.length,
      candidateRegionCount: state.candidateRegions.length,
      savedRegionCount: state.savedRegions.length,
    },
  };

  if (state.selection && state.frame) {
    observation.selectedRegionStats = getRoiStats(state.selection);
  }
  if (state.selection && state.compare.active) {
    observation.selectedRegionCompareLoss = getCompareRoiLossNoRefresh(state.selection);
  }
  if (options.includeScreenshot) {
    observation.screenshotDataUrl = window.LEapsViewer.screenshot({
      source: options.screenshotSource || "canvas",
    });
  }

  return observation;
}

function connectViewerBridge() {
  const bridgeUrl = bridgeUrlFromLocation();
  if (!bridgeUrl || !("WebSocket" in window)) return;

  let socket = null;
  let reconnectTimer = null;
  let reconnectDelay = 500;
  const viewerId = `viewer-${Math.random().toString(36).slice(2, 10)}`;

  const connect = () => {
    socket = new WebSocket(bridgeUrl);

    socket.addEventListener("open", () => {
      reconnectDelay = 500;
      socket.send(JSON.stringify({
        type: "register-viewer",
        viewerId,
        info: {
          url: window.location.href,
          title: document.title,
          userAgent: navigator.userAgent,
        },
      }));
    });

    socket.addEventListener("message", (event) => {
      handleBridgeMessage(socket, event.data).catch((error) => {
        safeBridgeSend(socket, {
          type: "response",
          id: tryParseBridgeId(event.data),
          ok: false,
          error: error.message,
        });
      });
    });

    socket.addEventListener("close", () => {
      reconnectTimer = window.setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(8000, reconnectDelay * 1.6);
    });
  };

  window.addEventListener("beforeunload", () => {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    socket?.close();
  });
  connect();
}

function bridgeUrlFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("bridge");
  if (explicit === "off") return "";
  if (explicit) return explicit;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname || "127.0.0.1"}:8787`;
}

async function handleBridgeMessage(socket, raw) {
  const message = JSON.parse(String(raw));
  if (message.type !== "command") return;
  try {
    const result = await dispatchBridgeCommand(message.command);
    safeBridgeSend(socket, {
      type: "response",
      id: message.id,
      ok: true,
      result,
    });
  } catch (error) {
    safeBridgeSend(socket, {
      type: "response",
      id: message.id,
      ok: false,
      error: error.message,
    });
  }
}

async function dispatchBridgeCommand(command = {}) {
  const scope = command.scope || "viewer";
  const method = command.method;
  const argument = command.argument;
  if (scope === "compare") {
    const api = window.LEapsViewer.compare;
    if (!api || typeof api[method] !== "function") {
      throw new Error(`window.LEapsViewer.compare.${method} is not available.`);
    }
    return api[method](argument);
  }
  const api = window.LEapsViewer;
  if (!api || typeof api[method] !== "function") {
    throw new Error(`window.LEapsViewer.${method} is not available.`);
  }
  return api[method](argument);
}

function safeBridgeSend(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function tryParseBridgeId(raw) {
  try {
    return JSON.parse(String(raw)).id || null;
  } catch {
    return null;
  }
}

function getVisibleImageRect() {
  const rect = els.canvas.getBoundingClientRect();
  if (state.compare.active) {
    const tile = state.compare.tileRects.find((item) => !item.isDiff && item.index === state.compare.gtIndex)
      || state.compare.tileRects.find((item) => !item.isDiff);
    if (!tile) {
      return {
        x: 0,
        y: 0,
        width: state.compare.width,
        height: state.compare.height,
        coordinateBasis: "image-pixel",
        approximate: true,
      };
    }
    const left = (tile.imageRect.x - tile.imageRect.x - state.compare.view.offsetX) / state.compare.view.scale;
    const top = (tile.imageRect.y - tile.imageRect.y - state.compare.view.offsetY) / state.compare.view.scale;
    const right = (tile.imageRect.width - state.compare.view.offsetX) / state.compare.view.scale;
    const bottom = (tile.imageRect.height - state.compare.view.offsetY) / state.compare.view.scale;
    const x = clamp(Math.floor(left), 0, state.compare.width);
    const y = clamp(Math.floor(top), 0, state.compare.height);
    const x2 = clamp(Math.ceil(right), x, state.compare.width);
    const y2 = clamp(Math.ceil(bottom), y, state.compare.height);
    return {
      x,
      y,
      width: x2 - x,
      height: y2 - y,
      coordinateBasis: "image-pixel",
      compareTile: compareLabel(tile.index),
    };
  }
  if (!state.frame) return null;
  const topLeft = screenToImage({ x: 0, y: 0 });
  const bottomRight = screenToImage({ x: rect.width, y: rect.height });
  const x = clamp(Math.floor(topLeft.x), 0, state.frame.width);
  const y = clamp(Math.floor(topLeft.y), 0, state.frame.height);
  const x2 = clamp(Math.ceil(bottomRight.x), x, state.frame.width);
  const y2 = clamp(Math.ceil(bottomRight.y), y, state.frame.height);
  return {
    x,
    y,
    width: x2 - x,
    height: y2 - y,
    coordinateBasis: "image-pixel",
  };
}

function getState() {
  return {
    mode: state.mode,
    sourceName: state.sourceName,
    viewMode: state.viewMode,
    bayerPattern: state.bayerPattern,
    inputBitDepth: state.inputBitDepth,
    whiteBalance: { ...state.wbGains },
    brightness: 2 ** state.tone.exposureEv,
    frame: state.frame
      ? {
          kind: state.frame.kind,
          width: state.frame.width,
          height: state.frame.height,
          orientation: state.frame.orientation,
          bitDepth: state.frame.bitDepth,
          blackLevel: state.frame.blackLevel,
          whiteLevel: state.frame.whiteLevel,
          defects: state.frame.defects,
          stats: state.frame.stats,
        }
      : null,
    viewport: { ...state.viewport },
    selection: state.selection ? { ...state.selection } : null,
    markers: state.markers.map((marker) => ({ ...marker })),
    candidateRegions: state.candidateRegions.map((region) => ({ ...region })),
    compare: getCompareState(),
    savedRegions: getSavedRegions(),
    te42Analysis: state.te42Analysis,
    tone: { ...state.tone },
  };
}

function getCompareState() {
  return {
    active: state.compare.active,
    videoCount: state.compare.videos.length,
    sourceCount: state.compare.videos.length,
    videos: state.compare.videos.map((track, index) => ({
      index,
      label: compareLabel(index),
      kind: track.kind,
      name: track.name,
      width: compareTrackWidth(track),
      height: compareTrackHeight(track),
      duration: compareTrackDuration(track),
      bayerPattern: track.frame?.bayerPattern,
      bitDepth: track.frame?.bitDepth,
    })),
    width: state.compare.width,
    height: state.compare.height,
    duration: state.compare.duration,
    currentTime: state.compare.currentTime,
    playing: state.compare.playing,
    gtIndex: state.compare.gtIndex,
    targetIndex: state.compare.targetIndex,
    domain: state.compare.domain,
    metric: state.compare.metric,
    gradient: state.compare.gradient,
    roiMode: state.compare.roiMode,
    overlayHold: state.compare.overlayHold,
    loss: state.compare.loss,
    roi: state.selection ? { ...state.selection } : null,
    roiLoss: state.selection ? getCompareRoiLossNoRefresh(state.selection) : null,
    worstRegions: state.compare.worstRegions.map((region) => ({ ...region })),
    worstTimes: state.compare.worstTimes.map((time) => ({ ...time })),
    view: { ...state.compare.view },
  };
}

function expandedWhiteBalance() {
  return {
    r: state.wbGains.r,
    g: state.wbGains.g,
    gr: state.wbGains.g,
    gb: state.wbGains.g,
    b: state.wbGains.b,
  };
}

function formatFloat(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(3);
  return value.toPrecision(3);
}

function formatDb(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)} dB`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMtf(value, censored = false) {
  if (!Number.isFinite(value)) return "-";
  return `${censored ? ">=" : ""}${value.toFixed(3)} cyc/px`;
}

function formatControlNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function formatMultiplier(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return "0.000";
  return value.toFixed(3);
}

function formatPsnr(value) {
  if (value === Number.POSITIVE_INFINITY) return "inf";
  return `${formatFloat(value)} dB`;
}

function compareLabel(index) {
  return String.fromCharCode(65 + Number(index || 0));
}

function compareDomainLabel(domain) {
  return domain === "raw-bayer" ? "Raw Bayer" : "Rendered RGB";
}

function isTe42SourceName(name = state.sourceName) {
  const source = String(name || "");
  const frameSource = JSON.stringify(state.frame?.source || {});
  return /te42|synthetic_iq_chart|chart/i.test(source) || /te42|synthetic_iq_chart|chart/i.test(frameSource);
}

function percentileSorted(sortedValues, percentile) {
  if (!sortedValues.length) return NaN;
  const index = ((sortedValues.length - 1) * percentile) / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return lerp(sortedValues[lower], sortedValues[upper], index - lower);
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampFinite(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return clamp(number, min, max);
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
