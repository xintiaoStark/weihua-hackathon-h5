"""Turn the generated plush artwork into web-ready assets.

Sprite sheets are white-balanced so their cream background becomes pure white,
which lets the icons sit on any light tile via `mix-blend-mode: multiply`.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

SRC = Path(r"C:\Users\13569\.factory\generated-images")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)

SHEETS = {
    "a-sprite-sheet-of-6-separate-fuzzy-plush-toy-3d.png": [
        "track-make", "track-market", "track-hr", "track-service", "track-content", "pin",
    ],
    "a-sprite-sheet-of-6-separate-fuzzy-plush-toy-3d-3.png": [
        "calendar", "food", "ticket", "handshake", "medal", "factory",
    ],
    "a-sprite-sheet-of-6-separate-fuzzy-plush-toy-3d-2.png": [
        "rocket", "robot", "student", "puzzle", "laptop", "mic",
    ],
    "a-sprite-sheet-of-6-separate-fuzzy-plush-toy-3d-4.png": [
        "scroll", "coins", "egg", "sunmoon", "bulb", "gift",
    ],
}

ICON_SIZE = 320


def border_color(arr: np.ndarray, band: int = 12) -> np.ndarray:
    strips = [arr[:band].reshape(-1, 3), arr[-band:].reshape(-1, 3),
              arr[:, :band].reshape(-1, 3), arr[:, -band:].reshape(-1, 3)]
    return np.median(np.concatenate(strips), axis=0)


def white_balance(arr: np.ndarray, bg: np.ndarray) -> np.ndarray:
    out = arr.astype(np.float32) * (255.0 / np.maximum(bg, 1))
    return np.clip(out, 0, 255).astype(np.uint8)


def trim_square(cell: np.ndarray, pad_ratio: float = 0.06, gutter: int = 14) -> Image.Image:
    # Neighbouring icons sometimes bleed a few pixels across the grid line.
    cell = cell.copy()
    cell[:gutter], cell[-gutter:] = 255, 255
    cell[:, :gutter], cell[:, -gutter:] = 255, 255
    diff = 255 - cell.min(axis=2)
    ys, xs = np.where(diff > 22)
    if len(xs) == 0:
        return Image.fromarray(cell)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = x1 - x0, y1 - y0
    side = int(max(w, h) * (1 + pad_ratio * 2))
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    crop = Image.fromarray(cell[y0:y1, x0:x1])
    canvas.paste(crop, ((side - w) // 2, (side - h) // 2))
    return canvas


def process_sheets() -> None:
    for name, labels in SHEETS.items():
        arr = np.array(Image.open(SRC / name).convert("RGB"))
        arr = white_balance(arr, border_color(arr))
        h, w, _ = arr.shape
        cw, ch = w // 3, h // 2
        for i, label in enumerate(labels):
            r, c = divmod(i, 3)
            cell = arr[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
            icon = trim_square(cell).resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
            icon.save(OUT / f"ic-{label}.webp", "WEBP", quality=86, method=6)


def save_photo(src_name: str, out_name: str, width: int) -> dict:
    img = Image.open(SRC / src_name).convert("RGB")
    ratio = width / img.width
    img = img.resize((width, round(img.height * ratio)), Image.LANCZOS)
    img.save(OUT / out_name, "WEBP", quality=84, method=6)
    arr = np.array(img)
    top = np.median(arr[:10].reshape(-1, 3), axis=0).astype(int)
    bottom = np.median(arr[-10:, :40].reshape(-1, 3), axis=0).astype(int)
    edge = border_color(arr).astype(int)
    to_hex = lambda v: "#%02x%02x%02x" % tuple(int(x) for x in v)
    return {"file": out_name, "size": img.size, "top": to_hex(top),
            "bottom": to_hex(bottom), "edge": to_hex(edge)}


def extract_qr() -> None:
    path = ROOT.parent / "30e7886b6151c4cc4e5dc2e210180045.png"
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    ok, pts = cv2.QRCodeDetector().detect(img)
    if not ok:
        raise SystemExit("QR code not found")
    pts = pts.reshape(-1, 2)
    x0, y0 = pts.min(axis=0).astype(int)
    x1, y1 = pts.max(axis=0).astype(int)
    m = 14
    crop = img[max(y0 - m, 0):y1 + m, max(x0 - m, 0):x1 + m]
    crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    Image.fromarray(crop).save(OUT / "signup-qr.png", optimize=True)


def favicon() -> None:
    img = Image.open(OUT / "ic-factory.webp").convert("RGB").resize((180, 180), Image.LANCZOS)
    img.save(OUT / "favicon.png", optimize=True)


if __name__ == "__main__":
    process_sheets()
    meta = {
        "hero": save_photo("fuzzy-plush-toy-3d-character-designer-art-toy-st.png", "hero-crane.webp", 900),
        "team": save_photo("fuzzy-plush-toy-3d-characters-designer-art-toy-c.png", "team.webp", 960),
        "trophy": save_photo("fuzzy-plush-toy-3d-object-designer-art-toy-style.png", "trophy.webp", 760),
    }
    extract_qr()
    favicon()
    print(json.dumps(meta, indent=2))
