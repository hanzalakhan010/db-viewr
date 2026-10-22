"""Local-first OCR engine for the Tools section.

Primary engine is RapidOCR (PaddleOCR models running on ONNX Runtime —
pure pip install, models bundled in the wheel, no network calls at
runtime). If it isn't installed, falls back to pytesseract when both the
package and the tesseract binary are available. If neither engine exists
the API returns a 503 with install instructions instead of crashing.
"""

import io
import threading
import time

from PIL import Image, ImageOps, UnidentifiedImageError


class OcrUnavailable(Exception):
    """No OCR engine is installed."""


class OcrBadImage(Exception):
    """Payload could not be decoded as an image."""


# ── Engine bootstrap ───────────────────────────────────────────────────────────
# Engine load takes ~0.3s and the model stays in memory (~100MB), so it is
# created once, lazily, behind a lock (gunicorn runs 1 worker / 4 threads).

_lock = threading.Lock()
_engine = None
_engine_name = None


def _get_engine():
    global _engine, _engine_name
    if _engine is not None:
        return _engine, _engine_name
    with _lock:
        if _engine is not None:
            return _engine, _engine_name
        try:
            from rapidocr_onnxruntime import RapidOCR

            _engine = RapidOCR()
            _engine_name = "rapidocr"
            return _engine, _engine_name
        except ImportError:
            pass
        try:
            import pytesseract

            pytesseract.get_tesseract_version()  # raises if binary missing
            _engine = pytesseract
            _engine_name = "tesseract"
            return _engine, _engine_name
        except Exception:
            raise OcrUnavailable(
                "No OCR engine installed. Run: pip install rapidocr-onnxruntime"
            ) from None


# ── Preprocessing ──────────────────────────────────────────────────────────────

# Below this size the recognition model tends to drop spaces and misread
# glyphs; a 2x lanczos upscale measurably fixes both. Above the cap,
# inference time grows without accuracy gains.
_UPSCALE_BELOW = 1500
_MAX_SIDE = 4096


def _prepare(img: Image.Image) -> Image.Image:
    img = ImageOps.exif_transpose(img)
    # Flatten transparency onto white — OCR models see transparent pixels
    # as black, which turns dark-text-on-transparent PNGs into black-on-black.
    if img.mode in ("RGBA", "LA", "PA") or (
        img.mode == "P" and "transparency" in img.info
    ):
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.split()[-1])
        img = flat
    else:
        img = img.convert("RGB")

    longest = max(img.size)
    if longest < _UPSCALE_BELOW:
        scale = 2.0
    elif longest > _MAX_SIDE:
        scale = _MAX_SIDE / longest
    else:
        scale = 1.0
    if scale != 1.0:
        img = img.resize(
            (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
            Image.LANCZOS,
        )
    return img


# ── Line reconstruction ────────────────────────────────────────────────────────
# RapidOCR returns one entry per detected text box. Boxes that sit on the
# same visual line (e.g. receipt columns: "Total" ... "$5.00") are merged
# by y-overlap and ordered left-to-right so the plain-text output reads
# naturally.


def _group_lines(items: list[dict]) -> list[dict]:
    items = sorted(items, key=lambda it: it["yc"])
    lines: list[list[dict]] = []
    for it in items:
        last = lines[-1] if lines else None
        if last is not None:
            ref = sum(m["yc"] for m in last) / len(last)
            height = sum(m["h"] for m in last) / len(last)
            if abs(it["yc"] - ref) <= 0.5 * max(height, it["h"]):
                last.append(it)
                continue
        lines.append([it])

    out = []
    for members in lines:
        members.sort(key=lambda m: m["x0"])
        out.append(
            {
                "text": " ".join(m["text"] for m in members),
                "confidence": round(
                    sum(m["score"] for m in members) / len(members), 4
                ),
                "box": [
                    round(min(m["x0"] for m in members)),
                    round(min(m["y0"] for m in members)),
                    round(max(m["x1"] for m in members)),
                    round(max(m["y1"] for m in members)),
                ],
            }
        )
    return out


def _run_rapidocr(engine, img: Image.Image) -> list[dict]:
    import numpy as np

    result, _elapse = engine(np.array(img))
    items = []
    for box, text, score in result or []:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append(
            {
                "text": text,
                "score": float(score),
                "x0": min(xs),
                "y0": min(ys),
                "x1": max(xs),
                "y1": max(ys),
                "yc": (min(ys) + max(ys)) / 2,
                "h": max(ys) - min(ys),
            }
        )
    return _group_lines(items)


def _run_tesseract(pytesseract, img: Image.Image) -> list[dict]:
    data = pytesseract.image_to_data(
        img, output_type=pytesseract.Output.DICT
    )
    rows: dict[tuple, dict] = {}
    for i, word in enumerate(data["text"]):
        word = (word or "").strip()
        if not word or int(data["conf"][i]) < 0:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        x0, y0 = data["left"][i], data["top"][i]
        x1, y1 = x0 + data["width"][i], y0 + data["height"][i]
        row = rows.setdefault(
            key,
            {"words": [], "confs": [], "x0": x0, "y0": y0, "x1": x1, "y1": y1},
        )
        row["words"].append(word)
        row["confs"].append(float(data["conf"][i]))
        row["x0"] = min(row["x0"], x0)
        row["y0"] = min(row["y0"], y0)
        row["x1"] = max(row["x1"], x1)
        row["y1"] = max(row["y1"], y1)
    return [
        {
            "text": " ".join(r["words"]),
            "confidence": round(sum(r["confs"]) / len(r["confs"]) / 100, 4),
            "box": [r["x0"], r["y0"], r["x1"], r["y1"]],
        }
        for r in rows.values()
    ]


# ── Public API ─────────────────────────────────────────────────────────────────


def ocr_image(data: bytes) -> dict:
    """Run OCR on raw image bytes. Returns text, per-line detail, and timing.

    Raises OcrUnavailable if no engine is installed, OcrBadImage if the
    bytes aren't a decodable image.
    """
    engine, name = _get_engine()
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise OcrBadImage(f"Could not decode image: {e}") from e

    orig_w, orig_h = img.size
    img = _prepare(img)

    started = time.time()
    if name == "rapidocr":
        lines = _run_rapidocr(engine, img)
    else:
        lines = _run_tesseract(engine, img)
    elapsed_ms = round((time.time() - started) * 1000)

    return {
        "text": "\n".join(line["text"] for line in lines),
        "lines": lines,
        "engine": name,
        "elapsed_ms": elapsed_ms,
        "width": orig_w,
        "height": orig_h,
        # box coordinates refer to the preprocessed image size
        "processed_width": img.width,
        "processed_height": img.height,
    }
