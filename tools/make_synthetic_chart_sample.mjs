import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const WIDTH = 500;
const HEIGHT = 375;
const BIT_DEPTH = 12;
const WHITE_LEVEL = (1 << BIT_DEPTH) - 1;
const PATTERN = "RGGB";

const SOURCE_PATH = "data/samples/synthetic_iq_chart.png";
const RAW_PATH = "data/derived/synthetic_iq_chart_rggb_12bit.raw";
const JSON_PATH = "data/derived/synthetic_iq_chart_rggb_12bit.json";
const PREVIEW_PATH = "data/derived/synthetic_iq_chart_rggb_12bit_cfa_preview.png";

const PLANES = {
  RGGB: [["R", "Gr"], ["Gb", "B"]],
};

const CHANNEL = {
  R: 0,
  Gr: 1,
  Gb: 1,
  B: 2,
};

const FALSE_COLOR = {
  R: [255, 64, 48],
  Gr: [80, 230, 96],
  Gb: [48, 190, 255],
  B: [80, 120, 255],
};

const rgb = new Uint8Array(WIDTH * HEIGHT * 3);

async function main() {
  drawSyntheticChart();
  const { raw, counts } = makeBayerMosaic();
  const preview = makeCfaPreview(raw);

  await awaitWritePng(SOURCE_PATH, rgb, WIDTH, HEIGHT);
  await awaitWriteRaw(RAW_PATH, raw);
  await awaitWritePng(PREVIEW_PATH, preview, WIDTH, HEIGHT);
  await awaitWriteMetadata(JSON_PATH, counts);
}

function drawSyntheticChart() {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const shade = 118 + Math.round(12 * x / WIDTH) + Math.round(8 * y / HEIGHT);
      setPixel(x, y, shade, shade, shade);
    }
  }

  fillRect(18, 18, 464, 339, 142, 142, 138);
  strokeRect(18, 18, 464, 339, 35, 35, 35, 3);
  strokeRect(29, 29, 442, 317, 205, 205, 198, 2);

  drawGrayScale();
  drawColorPatches();
  drawSlantedEdges();
  drawSiemensStar(250, 215, 64, 48);
  drawFaceTarget();
  drawFrequencyBars();
  drawFineGrid();
}

function drawGrayScale() {
  const levels = [32, 56, 82, 110, 138, 166, 196, 226];
  for (const [index, level] of levels.entries()) {
    fillRect(42 + index * 35, 48, 26, 45, level, level, level);
  }
  strokeRect(40, 46, 286, 49, 36, 36, 34, 2);

  for (let i = 0; i < 6; i += 1) {
    const level = 82 + i * 22;
    fillRect(42 + i * 44, 294, 32, 32, level, level, level);
  }
}

function drawColorPatches() {
  const patches = [
    [198, 64, 62], [63, 130, 205], [76, 166, 86], [212, 184, 72],
    [180, 83, 166], [58, 184, 184], [205, 122, 68], [104, 84, 66],
  ];
  for (const [index, color] of patches.entries()) {
    const x = 55 + (index % 4) * 44;
    const y = 122 + Math.floor(index / 4) * 40;
    fillRect(x, y, 30, 28, color[0], color[1], color[2]);
    strokeRect(x, y, 30, 28, 42, 42, 40, 1);
  }
}

function drawSlantedEdges() {
  fillSlantedEdge(332, 190, 74, 74, "vertical");
  fillSlantedEdge(90, 206, 90, 60, "horizontal");
  strokeRect(332, 190, 74, 74, 60, 60, 56, 2);
  strokeRect(90, 206, 90, 60, 60, 60, 56, 2);
}

function fillSlantedEdge(x0, y0, width, height, direction) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const boundary = direction === "vertical"
        ? width * 0.52 + (y - height / 2) * 0.18
        : height * 0.48 + (x - width / 2) * 0.14;
      const bright = direction === "vertical" ? x > boundary : y > boundary;
      const level = bright ? 224 : 34;
      setPixel(x0 + x, y0 + y, level, level, level);
    }
  }
}

function drawSiemensStar(cx, cy, radius, sectors) {
  fillCircle(cx, cy, radius + 8, 170, 170, 164);
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;
      const angle = Math.atan2(dy, dx) + Math.PI;
      const wedge = Math.floor((angle / (Math.PI * 2)) * sectors);
      const ringFade = 0.78 + 0.22 * distance / radius;
      const level = (wedge % 2 === 0 ? 234 : 24) * ringFade + 128 * (1 - ringFade);
      setPixel(x, y, level, level, level);
    }
  }
  fillCircle(cx, cy, 6, 128, 128, 122);
  strokeCircle(cx, cy, radius, 44, 44, 42, 2);
}

function drawFaceTarget() {
  fillRect(340, 35, 90, 70, 154, 146, 142);
  strokeRect(340, 35, 90, 70, 52, 52, 48, 2);
  fillEllipse(385, 68, 24, 29, 212, 158, 126);
  fillEllipse(385, 50, 27, 13, 78, 58, 44);
  fillEllipse(371, 67, 3, 2, 42, 34, 32);
  fillEllipse(398, 67, 3, 2, 42, 34, 32);
  drawLine(377, 83, 394, 83, 132, 62, 64, 2);
  fillRect(360, 94, 51, 10, 80, 118, 178);
}

function drawFrequencyBars() {
  const startX = 326;
  for (let group = 0; group < 5; group += 1) {
    const pitch = 8 - group;
    const x0 = startX + group * 29;
    fillRect(x0, 292, 24, 36, 238, 238, 232);
    for (let x = 0; x < 24; x += pitch) {
      fillRect(x0 + x, 292, Math.max(1, Math.floor(pitch / 2)), 36, 26, 26, 24);
    }
    strokeRect(x0, 292, 24, 36, 70, 70, 66, 1);
  }
}

function drawFineGrid() {
  for (let x = 32; x <= 468; x += 36) {
    drawLine(x, 32, x, 342, 117, 117, 112, 1);
  }
  for (let y = 32; y <= 342; y += 36) {
    drawLine(32, y, 468, y, 117, 117, 112, 1);
  }
}

function makeBayerMosaic() {
  const raw = new Uint16Array(WIDTH * HEIGHT);
  const counts = { R: 0, Gr: 0, Gb: 0, B: 0 };
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const plane = PLANES[PATTERN][y % 2][x % 2];
      const value = rgb[(y * WIDTH + x) * 3 + CHANNEL[plane]];
      const noise = deterministicNoise(x, y);
      raw[y * WIDTH + x] = clamp(Math.round(value / 255 * WHITE_LEVEL + noise), 0, WHITE_LEVEL);
      counts[plane] += 1;
    }
  }
  return { raw, counts };
}

function makeCfaPreview(raw) {
  const preview = new Uint8Array(WIDTH * HEIGHT * 3);
  let max = 1;
  for (const value of raw) max = Math.max(max, value);

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const plane = PLANES[PATTERN][y % 2][x % 2];
      const intensity = Math.sqrt(raw[y * WIDTH + x] / max);
      const color = FALSE_COLOR[plane];
      const offset = (y * WIDTH + x) * 3;
      preview[offset] = Math.round(intensity * color[0]);
      preview[offset + 1] = Math.round(intensity * color[1]);
      preview[offset + 2] = Math.round(intensity * color[2]);
    }
  }
  return preview;
}

async function awaitWriteRaw(path, raw) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const bytes = Buffer.alloc(raw.length * 2);
  for (let i = 0; i < raw.length; i += 1) {
    bytes.writeUInt16LE(raw[i], i * 2);
  }
  await writeFile(path, bytes);
}

async function awaitWriteMetadata(path, counts) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const metadata = {
    kind: "bayer-frame",
    width: WIDTH,
    height: HEIGHT,
    storageDtype: "uint16",
    endianness: "little",
    bitDepth: BIT_DEPTH,
    blackLevel: 0,
    whiteLevel: WHITE_LEVEL,
    rowStrideBytes: WIDTH * 2,
    bayerPattern: PATTERN,
    source: {
      type: "synthetic-public-fixture",
      path: SOURCE_PATH,
      description: "Deterministic synthetic image-quality chart generated in-repo. No third-party image content.",
    },
    artifacts: {
      raw: RAW_PATH,
      preview: PREVIEW_PATH,
    },
    generation: {
      script: "tools/make_synthetic_chart_sample.mjs",
      license: "CC0-1.0",
    },
    cfaSiteCounts: counts,
  };
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function awaitWritePng(path, pixels, width, height) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, encodePng(pixels, width, height));
}

function encodePng(pixels, width, height) {
  const stride = width * 3 + 1;
  const scanlines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    scanlines[row] = 0;
    for (let x = 0; x < width * 3; x += 1) {
      scanlines[row + 1 + x] = pixels[y * width * 3 + x];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 2;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function setPixel(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (Math.floor(y) * WIDTH + Math.floor(x)) * 3;
  rgb[offset] = clamp(Math.round(r), 0, 255);
  rgb[offset + 1] = clamp(Math.round(g), 0, 255);
  rgb[offset + 2] = clamp(Math.round(b), 0, 255);
}

function fillRect(x, y, width, height, r, g, b) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(xx, yy, r, g, b);
    }
  }
}

function strokeRect(x, y, width, height, r, g, b, lineWidth = 1) {
  fillRect(x, y, width, lineWidth, r, g, b);
  fillRect(x, y + height - lineWidth, width, lineWidth, r, g, b);
  fillRect(x, y, lineWidth, height, r, g, b);
  fillRect(x + width - lineWidth, y, lineWidth, height, r, g, b);
}

function fillCircle(cx, cy, radius, r, g, b) {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) setPixel(x, y, r, g, b);
    }
  }
}

function strokeCircle(cx, cy, radius, r, g, b, lineWidth = 1) {
  for (let y = cy - radius - lineWidth; y <= cy + radius + lineWidth; y += 1) {
    for (let x = cx - radius - lineWidth; x <= cx + radius + lineWidth; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(distance - radius) <= lineWidth) setPixel(x, y, r, g, b);
    }
  }
}

function fillEllipse(cx, cy, rx, ry, r, g, b) {
  for (let y = cy - ry; y <= cy + ry; y += 1) {
    for (let x = cx - rx; x <= cx + rx; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(x, y, r, g, b);
    }
  }
}

function drawLine(x0, y0, x1, y1, r, g, b, lineWidth = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps ? i / steps : 0;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    fillRect(x - Math.floor(lineWidth / 2), y - Math.floor(lineWidth / 2), lineWidth, lineWidth, r, g, b);
  }
}

function deterministicNoise(x, y) {
  let value = (x * 73856093) ^ (y * 19349663) ^ 0x9e3779b9;
  value ^= value >>> 13;
  value = Math.imul(value, 1274126177);
  value ^= value >>> 16;
  return (value & 7) - 3;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

await main();
