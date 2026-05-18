#!/usr/bin/env python3
"""Create a deterministic Bayer mosaic sample from a Radiance HDR image."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Tuple

import cv2
import imageio.v3 as iio
import numpy as np


PATTERN_PLANES: Dict[str, Tuple[Tuple[str, str], Tuple[str, str]]] = {
    "RGGB": (("R", "Gr"), ("Gb", "B")),
    "BGGR": (("B", "Gb"), ("Gr", "R")),
    "GRBG": (("Gr", "R"), ("B", "Gb")),
    "GBRG": (("Gb", "B"), ("R", "Gr")),
}

CHANNEL_INDEX = {
    "R": 0,
    "Gr": 1,
    "Gb": 1,
    "B": 2,
}

FALSE_COLOR = {
    "R": np.array([255, 64, 48], dtype=np.float32),
    "Gr": np.array([80, 230, 96], dtype=np.float32),
    "Gb": np.array([48, 190, 255], dtype=np.float32),
    "B": np.array([80, 120, 255], dtype=np.float32),
}


def read_hdr_rgb(path: Path) -> np.ndarray:
    """Read an HDR image as RGB float32."""
    try:
        img = iio.imread(path)
        img = np.asarray(img)
        if img.ndim == 2:
            img = np.repeat(img[..., None], 3, axis=2)
        if img.shape[2] > 3:
            img = img[..., :3]
        return img.astype(np.float32, copy=False)
    except Exception:
        img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if img is None:
            raise RuntimeError(f"Could not read HDR image: {path}")
        if img.ndim == 2:
            img = np.repeat(img[..., None], 3, axis=2)
        if img.shape[2] > 3:
            img = img[..., :3]
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32, copy=False)


def normalize_to_active_range(
    rgb: np.ndarray,
    bit_depth: int,
    clip_percentile: float,
) -> Tuple[np.ndarray, float]:
    rgb = np.nan_to_num(rgb, nan=0.0, posinf=0.0, neginf=0.0)
    rgb = np.maximum(rgb, 0.0)
    scale = float(np.percentile(rgb, clip_percentile))
    if not np.isfinite(scale) or scale <= 0:
        scale = float(np.max(rgb))
    if not np.isfinite(scale) or scale <= 0:
        scale = 1.0

    white_level = (1 << bit_depth) - 1
    scaled = np.clip(rgb / scale, 0.0, 1.0) * white_level
    return np.rint(scaled).astype(np.uint16), scale


def make_bayer(rgb_u16: np.ndarray, pattern: str) -> Tuple[np.ndarray, Dict[str, int]]:
    h, w, _ = rgb_u16.shape
    mosaic = np.zeros((h, w), dtype=np.uint16)
    counts: Dict[str, int] = {}
    planes = PATTERN_PLANES[pattern]

    for y_mod in (0, 1):
        for x_mod in (0, 1):
            plane = planes[y_mod][x_mod]
            channel = CHANNEL_INDEX[plane]
            view = rgb_u16[y_mod::2, x_mod::2, channel]
            mosaic[y_mod::2, x_mod::2] = view
            counts[plane] = int(view.size)

    return mosaic, counts


def save_preview_png(mosaic: np.ndarray, pattern: str, path: Path) -> None:
    white = max(int(mosaic.max()), 1)
    intensity = np.sqrt(mosaic.astype(np.float32) / white)
    preview = np.zeros((*mosaic.shape, 3), dtype=np.float32)
    planes = PATTERN_PLANES[pattern]

    for y_mod in (0, 1):
        for x_mod in (0, 1):
            plane = planes[y_mod][x_mod]
            color = FALSE_COLOR[plane]
            preview[y_mod::2, x_mod::2, :] = intensity[y_mod::2, x_mod::2, None] * color

    preview = np.clip(preview, 0, 255).astype(np.uint8)
    cv2.imwrite(str(path), cv2.cvtColor(preview, cv2.COLOR_RGB2BGR))


def write_metadata(
    *,
    path: Path,
    source: Path,
    raw_path: Path,
    preview_path: Path,
    pattern: str,
    bit_depth: int,
    width: int,
    height: int,
    clip_percentile: float,
    hdr_scale_value: float,
    cfa_counts: Dict[str, int],
) -> None:
    white_level = (1 << bit_depth) - 1
    metadata = {
        "kind": "bayer-frame",
        "width": width,
        "height": height,
        "storageDtype": "uint16",
        "bitDepth": bit_depth,
        "endianness": "little",
        "bayerPattern": pattern,
        "blackLevel": 0,
        "whiteLevel": white_level,
        "rowStrideBytes": width * 2,
        "source": {
            "path": str(source),
            "type": "radiance-hdr-rgb",
        },
        "artifacts": {
            "raw": str(raw_path),
            "preview": str(preview_path),
        },
        "conversion": {
            "method": "select-cfa-site-from-rgb",
            "clipPercentile": clip_percentile,
            "hdrScaleValue": hdr_scale_value,
        },
        "cfaSiteCounts": cfa_counts,
    }
    path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_hdr", type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("data/derived"))
    parser.add_argument("--name", default=None)
    parser.add_argument("--pattern", choices=sorted(PATTERN_PLANES), default="RGGB")
    parser.add_argument("--bit-depth", type=int, default=12)
    parser.add_argument("--clip-percentile", type=float, default=99.9)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 1 <= args.bit_depth <= 16:
        raise ValueError("--bit-depth must be between 1 and 16")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.name or args.input_hdr.stem
    base = f"{stem}_{args.pattern.lower()}_{args.bit_depth}bit"
    raw_path = args.out_dir / f"{base}.raw"
    json_path = args.out_dir / f"{base}.json"
    preview_path = args.out_dir / f"{base}_cfa_preview.png"

    rgb = read_hdr_rgb(args.input_hdr)
    rgb_u16, scale = normalize_to_active_range(
        rgb,
        bit_depth=args.bit_depth,
        clip_percentile=args.clip_percentile,
    )
    mosaic, counts = make_bayer(rgb_u16, args.pattern)

    raw_path.write_bytes(mosaic.astype("<u2", copy=False).tobytes(order="C"))
    save_preview_png(mosaic, args.pattern, preview_path)
    h, w = mosaic.shape
    write_metadata(
        path=json_path,
        source=args.input_hdr,
        raw_path=raw_path,
        preview_path=preview_path,
        pattern=args.pattern,
        bit_depth=args.bit_depth,
        width=w,
        height=h,
        clip_percentile=args.clip_percentile,
        hdr_scale_value=scale,
        cfa_counts=counts,
    )

    expected_bytes = w * h * 2
    actual_bytes = raw_path.stat().st_size
    if expected_bytes != actual_bytes:
        raise RuntimeError(
            f"Raw size mismatch: expected {expected_bytes}, got {actual_bytes}"
        )

    print(f"Wrote {raw_path}")
    print(f"Wrote {json_path}")
    print(f"Wrote {preview_path}")
    print(f"{w}x{h}, {args.pattern}, {args.bit_depth}-bit, raw bytes={actual_bytes}")


if __name__ == "__main__":
    main()
