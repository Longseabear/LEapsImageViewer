import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceMetadataPath = resolve("data/derived/aerodynamics_workshop_rggb_12bit.json");
const sourceRawPath = resolve("data/derived/aerodynamics_workshop_rggb_12bit.raw");
const outputMetadataPath = resolve("data/derived/aerodynamics_workshop_rggb_12bit_badpixels.json");
const outputRawPath = resolve("data/derived/aerodynamics_workshop_rggb_12bit_badpixels.raw");

const injectedBadPixels = [
  { x: 144, y: 78, type: "hot", value: 4095 },
  { x: 318, y: 214, type: "hot", value: 4095 },
  { x: 755, y: 195, type: "hot", value: 4095 },
  { x: 910, y: 340, type: "hot", value: 4095 },
  { x: 224, y: 390, type: "dead", value: 0 },
  { x: 612, y: 92, type: "dead", value: 0 },
  { x: 870, y: 122, type: "dead", value: 0 },
];

const metadata = JSON.parse(await readFile(sourceMetadataPath, "utf-8"));
const rawBytes = await readFile(sourceRawPath);
const raw = new Uint16Array(rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength));

for (const pixel of injectedBadPixels) {
  const index = pixel.y * metadata.width + pixel.x;
  raw[index] = pixel.value;
}

const outputRawRelative = "data\\derived\\aerodynamics_workshop_rggb_12bit_badpixels.raw";
const outputMetadata = {
  ...metadata,
  source: {
    path: metadata.artifacts.raw,
    type: "synthetic-bad-pixel-variant",
  },
  artifacts: {
    ...metadata.artifacts,
    raw: outputRawRelative,
  },
  defects: {
    injectedBadPixels,
    method: "deterministic-coordinate-overwrite",
  },
};

await writeFile(outputRawPath, Buffer.from(raw.buffer));
await writeFile(outputMetadataPath, JSON.stringify(outputMetadata, null, 2) + "\n", "utf-8");

console.log(`Wrote ${outputRawPath}`);
console.log(`Wrote ${outputMetadataPath}`);
console.log(`Injected ${injectedBadPixels.length} bad pixels in ${dirname(outputRawPath)}`);

