"""Generate a synthetic NDA and exercise the native redaction and OCR workflow."""

import argparse
import json
import os
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
from clearcopy import extract_clean, inspect_pdf, rebuild

TARGETS = ("Daniel Harper", "daniel.harper@example.com", "Taylor Morgan", "taylor.morgan@example.org")


def synthetic_nda():
    with pymupdf.open() as original, pymupdf.open() as scan:
        def design(page, title, contact, email):
            page.draw_rect(pymupdf.Rect(0, 0, 560, 64), color=None, fill=(0.16, 0.11, 0.29))
            page.insert_text((43, 41), "NORTHWIND STUDIO  /  ALPINE RESEARCH", fontsize=11, color=(1, 1, 1), fontname="hebo")
            page.insert_text((43, 117), title, fontsize=25, fontname="hebo")
            page.insert_text((43, 145), "Software evaluation  |  Mutual obligations", fontsize=13)
            page.draw_line((43, 166), (517, 166), color=(0.75, 0.71, 0.82))
            sections = [
                ("1. Purpose", "The parties will exchange information to evaluate a proposed collaboration."),
                ("2. Confidential information", "Each party agrees to protect shared materials and restrict their use to the evaluation."),
                ("3. Duration", "This agreement remains in effect for two years from its effective date."),
            ]
            for index, (heading, body) in enumerate(sections):
                y = 205 + index * 70
                page.insert_text((43, y), heading, fontsize=13, fontname="hebo")
                page.insert_text((43, y + 22), body, fontsize=11)
            page.draw_rect(pymupdf.Rect(43, 395, 517, 490), color=(0.76, 0.72, 0.84), fill=(0.96, 0.95, 0.98))
            page.insert_text((58, 420), "Designated notice contact", fontsize=13, fontname="hebo")
            page.insert_text((58, 447), f"Contact name: {contact}", fontsize=12)
            page.insert_text((58, 471), f"Email address: {email}", fontsize=12)
            page.insert_text((43, 622), "SYNTHETIC SAMPLE  /  FOR DEMONSTRATION", fontsize=10)

        first = original.new_page(width=560, height=660)
        design(first, "Mutual Non-Disclosure Agreement", *TARGETS[:2])
        original.set_metadata({"author": TARGETS[0], "subject": TARGETS[1]})
        original.embfile_add("private.txt", TARGETS[1].encode())
        photographed = scan.new_page(width=560, height=660)
        design(photographed, "Notice Contact Schedule", *TARGETS[2:])
        image = photographed.get_pixmap(dpi=150)
        second = original.new_page(width=560, height=660)
        second.insert_image(second.rect, pixmap=image)
        return original.tobytes(garbage=4, deflate=True)


def verify(data, expected_pages, targets, anchor):
    with pymupdf.open(stream=data, filetype="pdf") as clean:
        assert len(clean) == expected_pages
        assert clean.embfile_count() == 0
        assert not clean.metadata.get("author")
        for index, page in enumerate(clean):
            assert not page.get_text().strip(), "Source text layer survived"
            assert not list(page.annots() or [])
            words = page.get_textpage_ocr(language="eng", full=True, dpi=175)
            visible = page.get_text(textpage=words).lower()
            assert anchor.lower() in visible, visible
            for target in targets:
                assert target.lower() not in visible, f"Sensitive value survived visually on page {index + 1}"
                assert target.encode() not in data, "Sensitive bytes found"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--verify-web", type=Path)
    parser.add_argument("--verify-web-scan", type=Path)
    args = parser.parse_args()
    if args.verify_web:
        verify(args.verify_web.read_bytes(), 1, TARGETS[:2], "Mutual Non-Disclosure Agreement")
        print("Web export verified with PyMuPDF text extraction and independent OCR.")
        return
    if args.verify_web_scan:
        verify(args.verify_web_scan.read_bytes(), 2, TARGETS, "SYNTHETIC SAMPLE")
        print("Web export of text and scanned pages verified with independent OCR.")
        return
    source = synthetic_nda()
    plan = inspect_pdf(source, "medium", "eng", os.getenv("TESSDATA_PREFIX"))
    assert all(page["boxes"] for page in plan["pages"])
    assert plan["pages"][0]["regions"] > 0
    exported = rebuild(source, plan)
    verify(exported, 2, TARGETS, "SYNTHETIC SAMPLE")
    for fmt in ("md", "json", "txt"):
        layout = extract_clean(exported, "eng", fmt)
        if fmt == "json":
            structured = json.loads(layout)
            assert structured["page_count"] == 2
            visible = " ".join(
                span["text"] for page in structured["pages"] for box in page["boxes"]
                for line in box.get("textlines", []) for span in line["spans"]
            )
        else:
            visible = layout
        assert "Confidential information" in visible
        assert "Mutual Non-Disclosure Agreement" in visible
        assert "Notice Contact Schedule" in visible
        assert not any(target.lower() in visible.lower() for target in TARGETS)
    print(f"PyMuPDF {pymupdf.__version__}: 2 pages, 4 synthetic target values absent, text/OCR/MD/JSON/TXT verified, {plan['milliseconds']} ms.")
    if args.assets:
        args.assets.mkdir(parents=True, exist_ok=True)
        for name, payload in (("nda-before", source), ("nda-after", exported)):
            (args.assets / f"{name}.pdf").write_bytes(payload)
            with pymupdf.open(stream=payload, filetype="pdf") as doc:
                doc[0].get_pixmap(dpi=95).save(args.assets / f"{name}.png")


if __name__ == "__main__":
    main()
