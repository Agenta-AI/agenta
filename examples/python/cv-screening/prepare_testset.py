"""Build the CV screening test set from a public resume dataset.

Downloads the `opensporks/resumes` dataset from Hugging Face (a mirror of
the Kaggle "Resume Dataset": ~2,400 real, anonymized resumes scraped from
livecareer.com), converts a curated subset to Markdown, and writes
`data/testset.csv`.

The subset is hand-picked so the classifications against the IT Manager
job spec (see `config.py`) have a meaningful spread: strong matches
(IT managers and directors), potential matches (IT specialists, an IT
supervisor, an engineering manager), and clear rejections (chef, teacher,
attorney, ...). Each row carries a human-assigned `expected_classification`
so you can run an exact-match evaluation in Agenta out of the box.

Usage:
    python prepare_testset.py            # writes data/testset.csv
    python prepare_testset.py --upload   # also uploads the test set to Agenta
"""

import argparse
import asyncio
import csv
import re
import sys
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup
from markdownify import markdownify

from config import TESTSET_NAME

PARQUET_URL = (
    "https://huggingface.co/api/datasets/opensporks/resumes"
    "/parquet/default/train/0.parquet"
)

DATA_DIR = Path(__file__).parent / "data"
CACHE_PATH = DATA_DIR / "resumes.parquet"
TESTSET_PATH = DATA_DIR / "testset.csv"

# Curated resume IDs with human-assigned ground truth against the
# IT Manager job spec. Reviewed by hand: titles alone are not reliable —
# e.g. 91697974 is labeled "Information Technology Coordinator" in the
# source dataset but is actually a paralegal CV (kept on purpose as a
# distractor, labeled no_match).
CURATED_RESUMES = {
    # --- strong matches: seasoned IT managers / directors ---
    18301617: "strong_match",  # IT Manager, 15 years, infra + budget + team
    13836471: "strong_match",  # IT Manager since 2007, network + budget, 80 users
    17688766: "strong_match",  # Director of IT
    28672970: "strong_match",  # Director of IT, executive profile
    41344156: "strong_match",  # VP of IT
    17681064: "strong_match",  # IT Senior Manager, 15+ years, vendor management
    # --- potential matches: relevant but missing scope or seniority ---
    33241454: "potential_match",  # IT Supervisor, 5 yrs IT, 1 yr supervisory (Army)
    24913648: "potential_match",  # IT Specialist, experienced network engineer
    66832845: "potential_match",  # IT Specialist I
    21780877: "potential_match",  # IT Specialist GS11 (government)
    25959103: "potential_match",  # Administrator of IT
    25990239: "potential_match",  # IT Instructor, 17 yrs IT, 12 yrs project mgmt
    44624796: "potential_match",  # Engineering Manager, 25 yrs mgmt, weak IT depth
    # --- no matches: too junior, mislabeled, or unrelated fields ---
    68460556: "no_match",  # IT Intern
    20024870: "no_match",  # IT Internship, recent MBA grad
    91697974: "no_match",  # "IT Coordinator" — actually a paralegal CV
    14206561: "no_match",  # Engineering Technician
    54227873: "no_match",  # Engineering Intern
    88907739: "no_match",  # Management Consultant, 4 yrs, no IT infra
    27096471: "no_match",  # HR Consultant
    38688388: "no_match",  # Director of Business Development
    25397102: "no_match",  # Business Development Analyst
    24221960: "no_match",  # Chef
    24444525: "no_match",  # Fitness Specialist
    19918523: "no_match",  # Teacher
    23138078: "no_match",  # Healthcare Administrator
    87118391: "no_match",  # Sales / Account Manager
    22323967: "no_match",  # HR Specialist
    23955183: "no_match",  # Finance Analyst
    14445309: "no_match",  # Advocate (attorney)
}


def download_dataset() -> pd.DataFrame:
    if not CACHE_PATH.exists():
        print(f"Downloading resume dataset to {CACHE_PATH} ...")
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        response = requests.get(PARQUET_URL, timeout=120)
        response.raise_for_status()
        CACHE_PATH.write_bytes(response.content)
    return pd.read_parquet(CACHE_PATH)


def resume_html_to_markdown(html: str) -> str:
    """Convert a livecareer resume HTML into clean Markdown.

    The source HTML uses semantic class names instead of heading tags,
    so we promote them before running markdownify.
    """
    soup = BeautifulSoup(html, "html.parser")

    for div in soup.find_all("div", class_="name"):
        div.name = "h1"
    for div in soup.find_all("div", class_="sectiontitle"):
        div.name = "h2"
    for span in soup.find_all("span", class_="jobtitle"):
        span.name = "strong"
    for span in soup.find_all("span", class_="degree"):
        span.name = "strong"
    for span in soup.find_all("span", class_="companyname"):
        span.name = "em"
    # Flatten layout tables so lists and text flow as normal blocks
    for tag in soup.find_all(["table", "tbody", "tr", "td", "th"]):
        tag.unwrap()

    md = markdownify(str(soup), heading_style="ATX", bullets="-")
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = re.sub(r"[ \t]{2,}", " ", md)
    return md.strip()


def build_testset(df: pd.DataFrame) -> list[dict]:
    rows = []
    for resume_id, expected in CURATED_RESUMES.items():
        matches = df[df["ID"] == resume_id]
        if matches.empty:
            print(f"warning: resume {resume_id} not found in dataset, skipping")
            continue
        record = matches.iloc[0]
        rows.append(
            {
                "cv": resume_html_to_markdown(record["Resume_html"]),
                "expected_classification": expected,
                "source_category": record["Category"],
                "source_id": str(resume_id),
            }
        )
    return rows


def write_csv(rows: list[dict]) -> None:
    with open(TESTSET_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "cv",
                "expected_classification",
                "source_category",
                "source_id",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} test cases to {TESTSET_PATH}")


async def upload_testset(rows: list[dict]) -> None:
    import agenta as ag
    from agenta.sdk.managers import testsets

    ag.init()
    testset = await testsets.aupsert(name=TESTSET_NAME, data=rows)
    if testset is None:
        sys.exit("Failed to upload test set to Agenta")
    print(f"Uploaded test set '{TESTSET_NAME}' to Agenta (id: {testset.testset_id})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--upload",
        action="store_true",
        help="upload the test set to Agenta (requires AGENTA_API_KEY)",
    )
    args = parser.parse_args()

    df = download_dataset()
    rows = build_testset(df)
    write_csv(rows)

    if args.upload:
        asyncio.run(upload_testset(rows))


if __name__ == "__main__":
    main()
