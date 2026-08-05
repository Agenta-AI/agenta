"""Render a few CVs as PDFs to upload in the Streamlit demo.

Writes four PDFs to `data/sample_cvs/`:

- the demo candidate: a strong IT Manager with **no German** — the CV the
  recruiter screens and flags in the walkthrough (not in the test set),
- a strong IT Manager who speaks German (advances before and after the
  prompt fix),
- a partial match and a clear rejection (German speakers, like the rest
  of the test set).

Usage:
    python make_sample_pdfs.py
"""

import re
from pathlib import Path

from fpdf import FPDF

from prepare_testset import (
    DEMO_RESUME_ID,
    add_languages_section,
    download_dataset,
    resume_html_to_markdown,
)

DATA_DIR = Path(__file__).parent / "data"
OUTPUT_DIR = DATA_DIR / "sample_cvs"

# Resume ID -> (file name, speaks German). The demo candidate is the only
# one without the Languages section the test set injects.
SAMPLES = {
    DEMO_RESUME_ID: ("candidate_it_manager.pdf", False),  # the demo CV
    13836471: ("candidate_it_manager_german.pdf", True),  # strong match
    33241454: ("candidate_it_supervisor.pdf", True),  # partial match
    24221960: ("candidate_chef.pdf", True),  # rejection
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
    df = download_dataset()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for resume_id, (filename, speaks_german) in SAMPLES.items():
        matches = df[df["ID"] == resume_id]
        if matches.empty:
            print(f"warning: resume {resume_id} not found in dataset, skipping")
            continue
        markdown = resume_html_to_markdown(matches.iloc[0]["Resume_html"])
        if speaks_german:
            markdown = add_languages_section(markdown)
        path = OUTPUT_DIR / filename
        markdown_to_pdf(markdown, path)
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
