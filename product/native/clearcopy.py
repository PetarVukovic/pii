"""Local ClearCopy PDF preflight. No files or document text are sent to an API."""

import argparse
import base64
import hashlib
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import pymupdf
import pymupdf4llm
from newmean_pii import create_redactor
from pymupdf4llm.ocr import tesseract_api

MASK_FILL = (57, 40, 71)
MASK_EDGE = (107, 75, 128)
MAX_INPUT = 25 * 1024 * 1024


@dataclass
class Word:
    text: str
    rect: pymupdf.Rect
    order: int


def word_boxes(raw, regions, detect):
    words = []
    for x0, y0, x1, y1, value, *_ in raw:
        rect = pymupdf.Rect(x0, y0, x1, y1)
        order = next(
            (i for i, region in enumerate(regions) if rect.intersects(pymupdf.Rect(region[:4]))),
            len(regions),
        )
        words.append(Word(value, rect, order))
    words.sort(key=lambda word: word.order)
    spans = detect(" ".join(word.text for word in words))
    offset = 0
    boxes = []
    for word in words:
        end = offset + len(word.text)
        match = next((span for span in spans if span.start < end and span.end > offset), None)
        if match:
            boxes.append({"rect": list(word.rect), "label": match.label})
        offset = end + 1
    return boxes


def load_pdf(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        raise ValueError("Input exceeds 25 MiB.")
    return data


def inspect_pdf(data, model, lang, tessdata):
    start = time.perf_counter()
    redactor = create_redactor(size=model, regex=True, whole_words=True)
    pymupdf4llm.use_layout(True)
    pages = []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        if doc.needs_pass or not 0 < len(doc) <= 20:
            raise ValueError("Use an unlocked PDF of no more than 20 pages.")
        for page in doc:
            page.get_layout()
            if not hasattr(page, "layout_information"):
                raise RuntimeError("PyMuPDF Layout did not initialize.")
            regions = page.layout_information
            dpi = max(1, min(180, int(2400 * 72 / max(page.rect.width, page.rect.height))))
            ocr = page.get_textpage_ocr(language=lang, dpi=dpi, full=True, tessdata=tessdata)
            boxes = word_boxes(page.get_text("words", sort=True), regions, redactor.detect)
            boxes += word_boxes(page.get_text("words", textpage=ocr, sort=True), regions, redactor.detect)
            unique = {tuple(round(point, 1) for point in item["rect"]): item for item in boxes}
            pages.append({"regions": len(regions), "boxes": list(unique.values())})
    return {"version": 1, "sha256": hashlib.sha256(data).hexdigest(), "model": model, "ocr_language": lang,
            "milliseconds": round((time.perf_counter() - start) * 1000), "pages": pages}


def rebuild(data, plan):
    if plan.get("version") != 1 or hashlib.sha256(data).hexdigest() != plan.get("sha256"):
        raise ValueError("Plan does not match this source PDF.")
    with pymupdf.open(stream=data, filetype="pdf") as original, pymupdf.open() as output:
        if original.needs_pass or not 0 < len(original) <= 20 or len(original) != len(plan["pages"]):
            raise ValueError("Invalid source or page count.")
        for page, review in zip(original, plan["pages"], strict=True):
            scale = max(0.01, min(2.5, 2400 / max(page.rect.width, page.rect.height)))
            matrix = pymupdf.Matrix(scale, scale)
            pixels = page.get_pixmap(matrix=matrix, colorspace=pymupdf.csRGB, alpha=False)
            for item in review["boxes"]:
                rect = item["rect"]
                if len(rect) != 4 or not all(isinstance(p, (int, float)) and math.isfinite(p) for p in rect):
                    raise ValueError("Invalid redaction rectangle.")
                box = pymupdf.Rect(rect)
                if box.is_empty:
                    raise ValueError("Empty redaction rectangle.")
                padding = max(2, box.height * 0.15)
                padded = pymupdf.Rect(box.x0 - padding, box.y0 - padding, box.x1 + padding, box.y1 + padding)
                region = (padded * page.rotation_matrix * matrix).irect & pixels.irect
                if not region.is_empty:
                    pixels.set_rect(region, MASK_FILL)
                    thickness = min(6, max(2, round(region.height / 8)))
                    edge = pymupdf.IRect(region.x0, region.y0, region.x1, min(region.y1, region.y0 + thickness))
                    pixels.set_rect(edge, MASK_EDGE)
            clean = output.new_page(width=page.rect.width, height=page.rect.height)
            clean.insert_image(clean.rect, pixmap=pixels)
        return output.tobytes(garbage=4, deflate=True)


def extract_clean(pdf, lang, file_format):
    pymupdf4llm.use_layout(True)
    options = dict(use_ocr=True, force_ocr=True, ocr_language=lang, ocr_dpi=180,
                   ocr_function=tesseract_api.exec_ocr)
    convert = {"md": pymupdf4llm.to_markdown, "json": pymupdf4llm.to_json, "txt": pymupdf4llm.to_text}
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        if file_format != "md":
            return convert[file_format](doc, **options)
        chunks = pymupdf4llm.to_markdown(doc, page_chunks=True, **options)
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        layout = json.loads(pymupdf4llm.to_json(doc, **options))
    rendered = []
    for chunk, page in zip(chunks, layout["pages"], strict=True):
        text = chunk["text"]
        first = next((box for box in page["boxes"] if box["boxclass"] != "page-header"), None)
        if first and first["boxclass"] == "section-header" and 1 <= first["header_level"] <= 6:
            title = " ".join(span["text"] for line in first.get("textlines", []) for span in line["spans"]).strip()
            if title and title not in " ".join(text.split()):
                text = f"{'#' * first['header_level']} {title}\n\n{text}"
        rendered.append(text.strip())
    return "\n\n".join(rendered) + "\n"


def write_new(path, contents):
    with path.open("xb") as stream:
        stream.write(contents)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    proposal = sub.add_parser("inspect", help="Create a private mask plan and preview PDF for review.")
    proposal.add_argument("source", type=Path)
    proposal.add_argument("--plan", required=True, type=Path)
    proposal.add_argument("--preview", required=True, type=Path)
    proposal.add_argument("--model", choices=["nano", "small", "medium", "large"], default="medium")
    proposal.add_argument("--language", choices=["eng", "hrv", "hrv+eng"], default="eng")
    proposal.add_argument("--tessdata")
    export = sub.add_parser("export", help="Rebuild the approved PDF and optionally create structured output.")
    export.add_argument("source", type=Path)
    export.add_argument("--plan", required=True, type=Path)
    export.add_argument("--output", required=True, type=Path)
    export.add_argument("--reviewed", action="store_true", required=True)
    export.add_argument("--include", nargs="*", choices=["md", "json", "txt"], default=[])
    export.add_argument("--bundle", type=Path)
    args = parser.parse_args()
    data = load_pdf(args.source)
    if args.command == "inspect":
        plan = inspect_pdf(data, args.model, args.language, args.tessdata)
        preview = rebuild(data, plan)
        write_new(args.plan, json.dumps(plan, indent=2).encode())
        write_new(args.preview, preview)
        print(f'{len(plan["pages"])} pages, {sum(len(page["boxes"]) for page in plan["pages"])} proposed marks, {plan["milliseconds"]} ms')
        return
    plan = json.loads(args.plan.read_bytes())
    pdf = rebuild(data, plan)
    if args.bundle and len(pdf) > 5_600_000:
        parser.error("PDF exceeds the MCP bundle limit. Export the PDF without --bundle.")
    extracted = {fmt: extract_clean(pdf, plan["ocr_language"], fmt) for fmt in set(args.include)}
    write_new(args.output, pdf)
    for fmt, content in extracted.items():
        write_new(args.output.with_suffix(f".{fmt}"), content.encode())
    if args.bundle:
        write_new(args.bundle, json.dumps({"version": 1, "pdf": base64.b64encode(pdf).decode()}).encode())


if __name__ == "__main__":
    main()
