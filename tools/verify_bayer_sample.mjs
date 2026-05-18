import { readFile } from "node:fs/promises";
import { parseBayerFrame, cfaPlaneAt, displayWhiteLevel, normalizeRawValue } from "../src/bayer/bayerFrame.js";

const metadataUrl = new URL("../data/derived/aerodynamics_workshop_rggb_12bit.json", import.meta.url);
const rawUrl = new URL("../data/derived/aerodynamics_workshop_rggb_12bit.raw", import.meta.url);

const metadata = JSON.parse(await readFile(metadataUrl, "utf-8"));
const rawBytes = await readFile(rawUrl);
const rawBuffer = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
const frame = parseBayerFrame(metadata, rawBuffer);

if (frame.width !== 1024 || frame.height !== 512) {
  throw new Error(`Unexpected Bayer sample size: ${frame.width}x${frame.height}`);
}

if (frame.raw.length !== frame.width * frame.height) {
  throw new Error("Bayer raw buffer has the wrong pixel count.");
}

if (frame.bitDepth !== 12 || displayWhiteLevel(frame.bitDepth) !== 4095) {
  throw new Error("Bayer bit depth normalization is wrong.");
}

const centerIndex = 256 * frame.width + 512;
const centerRaw = frame.raw[centerIndex];
const centerNorm = normalizeRawValue(centerRaw, frame.blackLevel, displayWhiteLevel(frame.bitDepth));

if (!Number.isFinite(centerNorm) || centerNorm < 0 || centerNorm > 1) {
  throw new Error("Bayer normalization is out of range.");
}

console.log(
  `Bayer sample OK: ${frame.width}x${frame.height}, ${frame.bayerPattern}, center=${centerRaw}, centerCfa=${cfaPlaneAt(frame.bayerPattern, 512, 256)}`,
);

const badMetadataUrl = new URL("../data/derived/aerodynamics_workshop_rggb_12bit_badpixels.json", import.meta.url);
const badRawUrl = new URL("../data/derived/aerodynamics_workshop_rggb_12bit_badpixels.raw", import.meta.url);
const badMetadata = JSON.parse(await readFile(badMetadataUrl, "utf-8"));
const badRawBytes = await readFile(badRawUrl);
const badRawBuffer = badRawBytes.buffer.slice(
  badRawBytes.byteOffset,
  badRawBytes.byteOffset + badRawBytes.byteLength,
);
const badFrame = parseBayerFrame(badMetadata, badRawBuffer);
const injected = badFrame.defects?.injectedBadPixels ?? [];

if (injected.length !== 7) {
  throw new Error(`Expected 7 injected bad pixels, got ${injected.length}.`);
}

for (const pixel of injected) {
  const actual = badFrame.raw[pixel.y * badFrame.width + pixel.x];
  if (actual !== pixel.value) {
    throw new Error(
      `Injected pixel mismatch at ${pixel.x},${pixel.y}: expected ${pixel.value}, got ${actual}`,
    );
  }
}

console.log(`Bad-pixel sample OK: ${injected.length} injected defects verified.`);

const chartMetadataUrl = new URL("../data/derived/synthetic_iq_chart_rggb_12bit.json", import.meta.url);
const chartRawUrl = new URL("../data/derived/synthetic_iq_chart_rggb_12bit.raw", import.meta.url);
const chartMetadata = JSON.parse(await readFile(chartMetadataUrl, "utf-8"));
const chartRawBytes = await readFile(chartRawUrl);
const chartRawBuffer = chartRawBytes.buffer.slice(
  chartRawBytes.byteOffset,
  chartRawBytes.byteOffset + chartRawBytes.byteLength,
);
const chartFrame = parseBayerFrame(chartMetadata, chartRawBuffer);

if (chartFrame.width !== 500 || chartFrame.height !== 375) {
  throw new Error(`Unexpected synthetic chart size: ${chartFrame.width}x${chartFrame.height}`);
}

if (chartMetadata.source?.url || !/synthetic/i.test(chartMetadata.source?.type || "")) {
  throw new Error("Synthetic chart metadata must not depend on a third-party image URL.");
}

console.log(`Synthetic chart OK: ${chartFrame.width}x${chartFrame.height}, ${chartFrame.bayerPattern}.`);
