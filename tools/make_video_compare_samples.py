from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "derived"
OUT_DIR.mkdir(parents=True, exist_ok=True)

WIDTH = 320
HEIGHT = 180
FPS = 24
FRAMES = 72


def draw_frame(index: int, *, shifted: bool) -> np.ndarray:
    frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    frame[:] = (26, 30, 35)

    # Stable background grid and window-like blocks.
    for x in range(0, WIDTH, 32):
        cv2.line(frame, (x, 0), (x, HEIGHT), (42, 48, 54), 1)
    for y in range(0, HEIGHT, 30):
        cv2.line(frame, (0, y), (WIDTH, y), (42, 48, 54), 1)

    cv2.rectangle(frame, (36, 35), (130, 120), (55, 70, 84), -1)
    cv2.rectangle(frame, (42, 42), (124, 114), (180, 210, 230), 2)
    cv2.line(frame, (83, 42), (83, 114), (180, 210, 230), 2)
    cv2.line(frame, (42, 78), (124, 78), (180, 210, 230), 2)

    cx = 180 + int(36 * np.sin(index / 9))
    cy = 90 + int(22 * np.cos(index / 13))
    if shifted:
        cx += 7
        cy -= 4
    color = (40, 210, 245) if not shifted else (70, 180, 255)
    cv2.circle(frame, (cx, cy), 18, color, -1)

    # A deterministic defect-like patch for the diff map.
    if shifted:
        cv2.rectangle(frame, (235, 58), (272, 92), (235, 70, 62), -1)
    else:
        cv2.rectangle(frame, (235, 58), (272, 92), (70, 160, 95), -1)

    label = "GT" if not shifted else "SHIFT"
    cv2.putText(frame, label, (12, HEIGHT - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 230, 225), 1)
    return frame


def write_video(path: Path, *, shifted: bool) -> None:
    fourcc = "VP80" if path.suffix.lower() == ".webm" else "mp4v"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*fourcc), FPS, (WIDTH, HEIGHT))
    if not writer.isOpened():
        raise RuntimeError(f"Could not open video writer for {path}")
    for index in range(FRAMES):
        writer.write(draw_frame(index, shifted=shifted))
    writer.release()


def main() -> None:
    write_video(OUT_DIR / "video_compare_gt.webm", shifted=False)
    write_video(OUT_DIR / "video_compare_shifted.webm", shifted=True)
    print(OUT_DIR / "video_compare_gt.webm")
    print(OUT_DIR / "video_compare_shifted.webm")


if __name__ == "__main__":
    main()
