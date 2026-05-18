export const BAYER_PATTERNS = ["RGGB", "BGGR", "GRBG", "GBRG"];

const PATTERN_PLANES = {
  RGGB: [
    ["R", "Gr"],
    ["Gb", "B"],
  ],
  BGGR: [
    ["B", "Gb"],
    ["Gr", "R"],
  ],
  GRBG: [
    ["Gr", "R"],
    ["B", "Gb"],
  ],
  GBRG: [
    ["Gb", "B"],
    ["R", "Gr"],
  ],
};

export function parseBayerFrame(metadata, rawBuffer) {
  if (metadata?.kind !== "bayer-frame") {
    throw new Error("Bayer sidecar must have kind='bayer-frame'.");
  }

  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Bayer sidecar has invalid width/height.");
  }

  const storageDtype = metadata.storageDtype || "uint16";
  if (storageDtype !== "uint16") {
    throw new Error(`Unsupported Bayer storageDtype: ${storageDtype}`);
  }

  const bayerPattern = metadata.bayerPattern || "RGGB";
  if (!BAYER_PATTERNS.includes(bayerPattern)) {
    throw new Error(`Unsupported Bayer pattern: ${bayerPattern}`);
  }

  const bitDepth = clampInteger(metadata.bitDepth ?? 16, 1, 16);
  const blackLevel = Number(metadata.blackLevel ?? 0);
  const whiteLevel = Number(metadata.whiteLevel ?? (2 ** bitDepth - 1));
  const raw = decodeUint16(rawBuffer, metadata.endianness || "little");
  const expectedPixels = width * height;

  if (raw.length < expectedPixels) {
    throw new Error(`Raw file is too small: expected ${expectedPixels} pixels, got ${raw.length}.`);
  }

  const samples = raw.length === expectedPixels ? raw : raw.slice(0, expectedPixels);

  return {
    kind: "bayer-frame",
    width,
    height,
    raw: samples,
    storageDtype,
    bitDepth,
    blackLevel,
    whiteLevel,
    rowStrideBytes: Number(metadata.rowStrideBytes ?? width * 2),
    bayerPattern,
    source: metadata.source ?? {},
    artifacts: metadata.artifacts ?? {},
    defects: metadata.defects ?? null,
    cfaSiteCounts: countCfaSites(width, height, bayerPattern),
    stats: computeRawStats(samples),
  };
}

export function cfaPlaneAt(pattern, x, y) {
  const planes = PATTERN_PLANES[pattern] ?? PATTERN_PLANES.RGGB;
  return planes[Math.abs(Math.floor(y)) % 2][Math.abs(Math.floor(x)) % 2];
}

export function getPlaneGain(plane, wbGains) {
  if (plane === "R") return Number(wbGains.r ?? 1);
  if (plane === "B") return Number(wbGains.b ?? 1);
  if (plane === "Gr") return Number(wbGains.gr ?? wbGains.g ?? 1);
  if (plane === "Gb") return Number(wbGains.gb ?? wbGains.g ?? 1);
  return 1;
}

export function displayWhiteLevel(bitDepth) {
  return 2 ** clampInteger(bitDepth, 1, 16) - 1;
}

export function normalizeRawValue(rawValue, blackLevel, whiteLevel) {
  const denom = Math.max(1, whiteLevel - blackLevel);
  return Math.max(0, Math.min(1, (rawValue - blackLevel) / denom));
}

function decodeUint16(rawBuffer, endianness) {
  if (endianness === "little") {
    return new Uint16Array(rawBuffer);
  }

  const view = new DataView(rawBuffer);
  const out = new Uint16Array(Math.floor(rawBuffer.byteLength / 2));
  const littleEndian = endianness !== "big";
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getUint16(i * 2, littleEndian);
  }
  return out;
}

function countCfaSites(width, height, pattern) {
  const counts = { R: 0, Gr: 0, Gb: 0, B: 0 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      counts[cfaPlaneAt(pattern, x, y)] += 1;
    }
  }
  return counts;
}

function computeRawStats(raw) {
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let sum = 0;
  for (const value of raw) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }

  const sorted = Array.from(raw).sort((a, b) => a - b);
  const percentile = (p) => {
    if (sorted.length === 0) return 0;
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round((p / 100) * (sorted.length - 1))),
    );
    return sorted[index];
  };

  return {
    min,
    max,
    mean: raw.length ? sum / raw.length : 0,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
  };
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
}
