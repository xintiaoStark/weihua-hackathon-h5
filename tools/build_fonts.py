"""Subset the display fonts to the characters the page actually uses.

Re-run after editing copy in any page (*.html) or any file under js/ (the
share poster draws its text from js/poster.js).
"""
from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
FONTS = Path(__file__).resolve().parent / "fonts"
OUT = ROOT / "assets" / "fonts"
OUT.mkdir(parents=True, exist_ok=True)

ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
EXTRA = "¥—–·×、，。：；！？“”‘’（）《》【】0123456789"


def page_text() -> str:
    files = [*sorted(ROOT.glob("*.html")), *sorted((ROOT / "js").rglob("*.js"))]
    return "".join(f.read_text(encoding="utf-8") for f in files)


def run(src: Path, dst: Path, chars: str) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    font = subset.load_font(str(src), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=chars)
    subsetter.subset(font)
    subset.save_font(font, str(dst), options)
    print(f"{dst.name}: {dst.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    cjk = sorted({ch for ch in page_text() if ord(ch) > 0x7F})
    run(FONTS / "ZCOOLKuaiLe-Regular.ttf", OUT / "display.woff2", "".join(cjk) + ASCII + EXTRA)
    run(FONTS / "Nunito.ttf", OUT / "num.woff2", ASCII + "¥—–·×")
