"""Render a few test set CVs as PDFs to upload in the Streamlit demo.

Picks one strong match, one partial match, and one rejection from
`data/testset.csv` and writes simple PDFs to `data/sample_cvs/`.

Usage:
    python make_sample_pdfs.py
"""

import csv
import re
import sys
from pathlib import Path

from fpdf import FPDF

from prepare_testset import CURATED_RESUMES

DATA_DIR = Path(__file__).parent / "data"
TESTSET_PATH = DATA_DIR / "testset.csv"
OUTPUT_DIR = DATA_DIR / "sample_cvs"

# Resume ID -> output file name. The CSV rows are written in
# CURATED_RESUMES order, so the ID's position gives the row index.
SAMPLES = {
    18301617: "candidate_it_manager.pdf",  # strong match
    33241454: "candidate_it_supervisor.pdf",  # partial match
    24221960: "candidate_chef.pdf",  # rejection
}

MAX_TOKEN_LENGTH = 50


def clean_text(text: str) -> str:
    """Strip markdown emphasis and make the text wrappable by fpdf."""
    text = re.sub(r"\*\*(.+?)\*\*|\*(.+?)\*", r"\1\2", text)
    text = text.replace("**", "")
    # fpdf wraps on spaces only; break up comma-joined runs and any token
    # too long for a single line.
    text = re.sub(r",(?=\S)", ", ", text)
    text = re.sub(
        rf"(\S{{{MAX_TOKEN_LENGTH}}})(?=\S)",
        r"\1 ",
        text,
    )
    return text


def markdown_to_pdf(markdown: str, path: Path) -> None:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    # Core PDF fonts are latin-1 only; drop anything outside it.
    markdown = markdown.encode("latin-1", errors="replace").decode("latin-1")

    def write_block(height: float, text: str) -> None:
        pdf.multi_cell(0, height, text, new_x="LMARGIN", new_y="NEXT")

    for line in markdown.split("\n"):
        line = line.strip()
        if line.startswith("# "):
            pdf.set_font("Helvetica", "B", 16)
            write_block(8, clean_text(line[2:]))
            pdf.ln(2)
        elif line.startswith("## "):
            pdf.ln(2)
            pdf.set_font("Helvetica", "B", 13)
            write_block(7, clean_text(line[3:]))
            pdf.ln(1)
        elif line.startswith("- "):
            pdf.set_font("Helvetica", "", 10)
            write_block(5, f"  - {clean_text(line[2:])}")
        elif line:
            pdf.set_font("Helvetica", "B" if "**" in line else "", 10)
            write_block(5, clean_text(line))
        else:
            pdf.ln(2)

    pdf.output(str(path))


def main() -> None:
    if not TESTSET_PATH.exists():
        sys.exit("data/testset.csv not found; run prepare_testset.py first")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(TESTSET_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    resume_ids = list(CURATED_RESUMES)
    for resume_id, filename in SAMPLES.items():
        index = resume_ids.index(resume_id)
        if index >= len(rows):
            print(f"warning: resume {resume_id} not in testset.csv, skipping")
            continue
        row = rows[index]
        path = OUTPUT_DIR / filename
        markdown_to_pdf(row["cv"], path)
        print(f"Wrote {path} (expected overall: {row['expected_overall_match']})")


if __name__ == "__main__":
    main()
