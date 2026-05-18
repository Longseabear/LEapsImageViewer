const RESOLUTION_RE = /^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)$/;

export function parseRadianceHdr(buffer) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  const headerLines = [];
  let resolution = null;

  while (offset < bytes.length) {
    const { line, nextOffset } = readAsciiLine(bytes, offset);
    offset = nextOffset;
    const trimmed = line.trim();
    headerLines.push(trimmed);

    const match = trimmed.match(RESOLUTION_RE);
    if (match) {
      resolution = {
        ySign: match[1],
        height: Number(match[2]),
        xSign: match[3],
        width: Number(match[4]),
      };
      break;
    }
  }

  if (!resolution) {
    throw new Error("Radiance HDR resolution line was not found.");
  }

  const { width, height, xSign, ySign } = resolution;
  const rgbe = decodeRgbePixels(bytes, offset, width, height, xSign, ySign);
  const rgb = rgbeToFloatRgb(rgbe);
  const stats = computeHdrStats(rgb);

  return {
    kind: "hdr-rgb",
    width,
    height,
    headerLines,
    orientation: `${ySign}Y ${xSign}X`,
    rgbe,
    rgb,
    stats,
  };
}

function readAsciiLine(bytes, offset) {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 10) end += 1;
  const lineEnd = end > offset && bytes[end - 1] === 13 ? end - 1 : end;
  const lineBytes = bytes.subarray(offset, lineEnd);
  const line = new TextDecoder("ascii").decode(lineBytes);
  return { line, nextOffset: end + 1 };
}

function decodeRgbePixels(bytes, offset, width, height, xSign, ySign) {
  if (width < 8 || width > 0x7fff || !isRleScanline(bytes, offset, width)) {
    return decodeFlatPixels(bytes, offset, width, height, xSign, ySign);
  }

  const out = new Uint8Array(width * height * 4);
  let cursor = offset;
  const channelData = new Uint8Array(width * 4);

  for (let fileY = 0; fileY < height; fileY += 1) {
    if (
      cursor + 4 > bytes.length ||
      bytes[cursor] !== 2 ||
      bytes[cursor + 1] !== 2 ||
      ((bytes[cursor + 2] << 8) | bytes[cursor + 3]) !== width
    ) {
      throw new Error(`Invalid Radiance RLE scanline at row ${fileY}.`);
    }
    cursor += 4;

    for (let channel = 0; channel < 4; channel += 1) {
      let x = 0;
      while (x < width) {
        if (cursor >= bytes.length) {
          throw new Error("Unexpected end of HDR RLE data.");
        }
        const count = bytes[cursor++];
        if (count > 128) {
          const runLength = count - 128;
          const value = bytes[cursor++];
          channelData.fill(value, channel * width + x, channel * width + x + runLength);
          x += runLength;
        } else {
          channelData.set(
            bytes.subarray(cursor, cursor + count),
            channel * width + x,
          );
          cursor += count;
          x += count;
        }
      }
    }

    for (let fileX = 0; fileX < width; fileX += 1) {
      const imageX = xSign === "+" ? fileX : width - 1 - fileX;
      const imageY = ySign === "-" ? fileY : height - 1 - fileY;
      const outIndex = (imageY * width + imageX) * 4;
      out[outIndex] = channelData[fileX];
      out[outIndex + 1] = channelData[width + fileX];
      out[outIndex + 2] = channelData[width * 2 + fileX];
      out[outIndex + 3] = channelData[width * 3 + fileX];
    }
  }

  return out;
}

function isRleScanline(bytes, offset, width) {
  return (
    offset + 4 <= bytes.length &&
    bytes[offset] === 2 &&
    bytes[offset + 1] === 2 &&
    ((bytes[offset + 2] << 8) | bytes[offset + 3]) === width
  );
}

function decodeFlatPixels(bytes, offset, width, height, xSign, ySign) {
  const expected = width * height * 4;
  if (offset + expected > bytes.length) {
    throw new Error("HDR file does not contain enough RGBE pixel data.");
  }

  const out = new Uint8Array(expected);
  for (let fileY = 0; fileY < height; fileY += 1) {
    for (let fileX = 0; fileX < width; fileX += 1) {
      const imageX = xSign === "+" ? fileX : width - 1 - fileX;
      const imageY = ySign === "-" ? fileY : height - 1 - fileY;
      const src = offset + (fileY * width + fileX) * 4;
      const dst = (imageY * width + imageX) * 4;
      out[dst] = bytes[src];
      out[dst + 1] = bytes[src + 1];
      out[dst + 2] = bytes[src + 2];
      out[dst + 3] = bytes[src + 3];
    }
  }
  return out;
}

function rgbeToFloatRgb(rgbe) {
  const rgb = new Float32Array((rgbe.length / 4) * 3);
  for (let src = 0, dst = 0; src < rgbe.length; src += 4, dst += 3) {
    const exponent = rgbe[src + 3];
    if (exponent === 0) continue;
    const scale = Math.pow(2, exponent - 136);
    rgb[dst] = rgbe[src] * scale;
    rgb[dst + 1] = rgbe[src + 1] * scale;
    rgb[dst + 2] = rgbe[src + 2] * scale;
  }
  return rgb;
}

function computeHdrStats(rgb) {
  const luminance = new Float32Array(rgb.length / 3);
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let sum = 0;

  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 1) {
    const y = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
    luminance[j] = y;
    if (y < min) min = y;
    if (y > max) max = y;
    sum += y;
  }

  const sorted = Array.from(luminance).sort((a, b) => a - b);
  const percentile = (p) => {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[index];
  };

  return {
    min,
    max,
    mean: sum / luminance.length,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
  };
}

