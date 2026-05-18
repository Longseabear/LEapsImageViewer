import {
  cfaPlaneAt,
  displayWhiteLevel,
  getPlaneGain,
  normalizeRawValue,
} from "./bayerFrame.js";

const CFA_COLORS = {
  R: [255, 64, 48],
  Gr: [80, 230, 96],
  Gb: [80, 230, 96],
  B: [80, 120, 255],
};

export function createBayerImageData(frame, options) {
  const mode = options.viewMode || "raw-mosaic";
  if (mode === "demosaic-preview") {
    return createBlockDemosaicImageData(frame, options);
  }

  const imageData = new ImageData(frame.width, frame.height);
  const dst = imageData.data;
  const whiteLevel = displayWhiteLevel(options.inputBitDepth ?? frame.bitDepth);
  const blackLevel = frame.blackLevel ?? 0;

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const pixelIndex = y * frame.width + x;
      const outIndex = pixelIndex * 4;
      const plane = cfaPlaneAt(options.bayerPattern || frame.bayerPattern, x, y);
      const rawNorm = normalizeRawValue(frame.raw[pixelIndex], blackLevel, whiteLevel);
      const gain = getPlaneGain(plane, options.wbGains || {});
      const value = applyTone(rawNorm * gain, options);

      if (mode === "cfa-false-color") {
        const color = CFA_COLORS[plane];
        dst[outIndex] = toByte(value * (color[0] / 255));
        dst[outIndex + 1] = toByte(value * (color[1] / 255));
        dst[outIndex + 2] = toByte(value * (color[2] / 255));
      } else if (mode.startsWith("plane-")) {
        const wanted = planeNameFromMode(mode);
        const visible = plane === wanted ? value : 0;
        dst[outIndex] = toByte(visible);
        dst[outIndex + 1] = toByte(visible);
        dst[outIndex + 2] = toByte(visible);
      } else {
        dst[outIndex] = toByte(rawNorm);
        dst[outIndex + 1] = toByte(rawNorm);
        dst[outIndex + 2] = toByte(rawNorm);
      }
      dst[outIndex + 3] = 255;
    }
  }

  return imageData;
}

function createBlockDemosaicImageData(frame, options) {
  const imageData = new ImageData(frame.width, frame.height);
  const dst = imageData.data;
  const pattern = options.bayerPattern || frame.bayerPattern;
  const whiteLevel = displayWhiteLevel(options.inputBitDepth ?? frame.bitDepth);
  const blackLevel = frame.blackLevel ?? 0;
  const wb = options.wbGains || {};

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
          values[plane] += normalizeRawValue(raw, blackLevel, whiteLevel);
          counts[plane] += 1;
        }
      }

      const r = average(values.R, counts.R) * getPlaneGain("R", wb);
      const gr = average(values.Gr, counts.Gr);
      const gb = average(values.Gb, counts.Gb);
      const greenCount = Number(counts.Gr > 0) + Number(counts.Gb > 0);
      const greenGain =
        (getPlaneGain("Gr", wb) * Number(counts.Gr > 0) +
          getPlaneGain("Gb", wb) * Number(counts.Gb > 0)) /
        Math.max(1, greenCount);
      const g = average(gr + gb, greenCount) * greenGain;
      const b = average(values.B, counts.B) * getPlaneGain("B", wb);
      const mapped = [
        toByte(applyTone(r, options)),
        toByte(applyTone(g, options)),
        toByte(applyTone(b, options)),
      ];

      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const x = blockX + dx;
          const y = blockY + dy;
          if (x >= frame.width || y >= frame.height) continue;
          const outIndex = (y * frame.width + x) * 4;
          dst[outIndex] = mapped[0];
          dst[outIndex + 1] = mapped[1];
          dst[outIndex + 2] = mapped[2];
          dst[outIndex + 3] = 255;
        }
      }
    }
  }

  return imageData;
}

function applyTone(value, options) {
  const exposure = 2 ** Number(options.tone?.exposureEv ?? 0);
  const gamma = Math.max(0.4, Number(options.tone?.gamma ?? 1));
  const exposed = Math.max(0, value * exposure);
  const mapped =
    options.tone?.operator === "linear" ? Math.min(1, exposed) : exposed / (1 + exposed);
  return Math.max(0, Math.min(1, mapped ** (1 / gamma)));
}

function planeNameFromMode(mode) {
  if (mode === "plane-r") return "R";
  if (mode === "plane-gr") return "Gr";
  if (mode === "plane-gb") return "Gb";
  if (mode === "plane-b") return "B";
  return "";
}

function average(sum, count) {
  return count > 0 ? sum / count : 0;
}

function toByte(value) {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}
