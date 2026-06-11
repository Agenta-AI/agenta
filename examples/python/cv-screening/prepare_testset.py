"""Build the CV screening test set from a public resume dataset.

Downloads the `opensporks/resumes` dataset from Hugging Face (a mirror of
the Kaggle "Resume Dataset": ~2,400 real, anonymized resumes scraped from
livecareer.com), converts a curated subset to Markdown, and writes
`data/testset.csv`.

The subset is hand-picked so the assessments against the IT Manager
job spec (see `config.py`) have a meaningful spread: strong matches
(IT managers and directors), partial matches (IT specialists, an IT
supervisor, an engineering manager), and clear rejections (chef, teacher,
attorney, ...). Each row carries human-assigned `expected_tech_match`,
`expected_experience_match`, and `expected_overall_match` booleans so you
can run a code evaluator in Agenta out of the box. An empty expected cell
means "no ground truth for this dimension" and is skipped by the evaluator.

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
# IT Manager job spec, as (tech_match, experience_match, overall_match)
# booleans. Reviewed by hand: titles alone are not reliable —
# e.g. 91697974 is labeled "Information Technology Coordinator" in the
# source dataset but is actually a paralegal CV (kept on purpose as a
# distractor).
CURATED_RESUMES = {
    # --- strong matches: seasoned IT managers / directors ---
    18301617: (True, True, True),  # IT Manager, 15 years, infra + budget + team
    13836471: (True, True, True),  # IT Manager since 2007, network + budget, 80 users
    17688766: (True, True, True),  # Director of IT
    28672970: (True, True, True),  # Director of IT, executive profile
    41344156: (True, True, True),  # VP of IT
    17681064: (True, True, True),  # IT Senior Manager, 15+ years, vendor management
    # --- partial matches: relevant but missing scope or seniority ---
    33241454: (True, False, False),  # IT Supervisor, 5 yrs IT, 1 yr supervisory (Army)
    24913648: (True, False, False),  # IT Specialist, experienced network engineer
    66832845: (True, False, False),  # IT Specialist I
    21780877: (True, False, False),  # IT Specialist GS11 (government)
    25959103: (True, False, False),  # Administrator of IT
    25990239: (True, True, False),  # IT Instructor, 17 yrs IT, teaching not ops
    44624796: (False, True, False),  # Engineering Manager, 25 yrs mgmt, weak IT depth
    # --- no matches: too junior, mislabeled, or unrelated fields ---
    68460556: (False, False, False),  # IT Intern
    20024870: (False, False, False),  # IT Internship, recent MBA grad
    91697974: (False, False, False),  # "IT Coordinator" — actually a paralegal CV
    14206561: (False, False, False),  # Engineering Technician
    54227873: (False, False, False),  # Engineering Intern
    88907739: (False, False, False),  # Management Consultant, 4 yrs, no IT infra
    27096471: (False, False, False),  # HR Consultant
    38688388: (False, False, False),  # Director of Business Development
    25397102: (False, False, False),  # Business Development Analyst
    24221960: (False, False, False),  # Chef
    24444525: (False, False, False),  # Fitness Specialist
    19918523: (False, False, False),  # Teacher
    23138078: (False, False, False),  # Healthcare Administrator
    87118391: (False, False, False),  # Sales / Account Manager
    22323967: (False, False, False),  # HR Specialist
    23955183: (False, False, False),  # Finance Analyst
    14445309: (False, False, False),  # Advocate (attorney)
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
    for resume_id, (tech, experience, overall) in CURATED_RESUMES.items():
        matches = df[df["ID"] == resume_id]
        if matches.empty:
            print(f"warning: resume {resume_id} not found in dataset, skipping")
            continue
        record = matches.iloc[0]
        rows.append(
            {
                "cv": resume_html_to_markdown(record["Resume_html"]),
                "expected_tech_match": str(tech).lower(),
                "expected_experience_match": str(experience).lower(),
                "expected_overall_match": str(overall).lower(),
            }
        )
    return rows


def write_csv(rows: list[dict]) -> None:
    with open(TESTSET_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "cv",
                "expected_tech_match",
                "expected_experience_match",
                "expected_overall_match",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} test cases to {TESTSET_PATH}")


async def upload_testset(rows: list[dict]) -> None:
    import agenta as ag
    from agenta.sdk.managers import testsets
    from dotenv import load_dotenv

    load_dotenv()
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
