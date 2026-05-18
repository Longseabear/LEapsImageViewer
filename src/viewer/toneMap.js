export function createToneMappedImageData(frame, options) {
  const { exposureEv, gamma, operator } = options;
  const exposure = Math.pow(2, exposureEv);
  const invGamma = 1 / gamma;
  const wb = options.wbGains || {};
  const redGain = Number(wb.r ?? 1);
  const greenGain = Number(wb.g ?? wb.gr ?? 1);
  const blueGain = Number(wb.b ?? 1);
  const imageData = new ImageData(frame.width, frame.height);
  const src = frame.rgb;
  const dst = imageData.data;

  for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
    const r = mapChannel(src[i] * redGain * exposure, operator);
    const g = mapChannel(src[i + 1] * greenGain * exposure, operator);
    const b = mapChannel(src[i + 2] * blueGain * exposure, operator);
    dst[j] = toByte(Math.pow(r, invGamma));
    dst[j + 1] = toByte(Math.pow(g, invGamma));
    dst[j + 2] = toByte(Math.pow(b, invGamma));
    dst[j + 3] = 255;
  }

  return imageData;
}

function mapChannel(value, operator) {
  if (operator === "linear") {
    return Math.min(1, Math.max(0, value));
  }
  return value / (1 + value);
}

function toByte(value) {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

export function defaultExposureEv(stats) {
  const anchor = stats?.p50 && stats.p50 > 0 ? stats.p50 : 0.18;
  return clamp(Math.log2(0.28 / anchor), -8, 8);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
