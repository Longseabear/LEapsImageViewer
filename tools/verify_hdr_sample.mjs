import { readFile } from "node:fs/promises";
import { parseRadianceHdr } from "../src/hdr/rgbe.js";

const samplePath = new URL("../data/samples/aerodynamics_workshop_1k.hdr", import.meta.url);
const bytes = await readFile(samplePath);
const frame = parseRadianceHdr(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

if (frame.width !== 1024 || frame.height !== 512) {
  throw new Error(`Unexpected sample size: ${frame.width}x${frame.height}`);
}

if (frame.rgb.length !== frame.width * frame.height * 3) {
  throw new Error("Float RGB buffer has the wrong length.");
}

if (!Number.isFinite(frame.stats.p50) || frame.stats.p50 <= 0) {
  throw new Error("HDR luminance stats look invalid.");
}

console.log(`HDR sample OK: ${frame.width}x${frame.height}, p50=${frame.stats.p50.toFixed(4)}, p99=${frame.stats.p99.toFixed(4)}`);

