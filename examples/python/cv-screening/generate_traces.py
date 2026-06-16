"""Generate screening traces in Agenta without feedback.

Screens a sample of CVs from `data/testset.csv` through the deployed prompt,
producing one trace per CV (each with a child LLM span and prompt references,
but no user annotation). Use this to seed a project with traces before a demo.

Usage:
    python generate_traces.py            # screens 15 CVs
    python generate_traces.py --count 27 # screens the whole curated set
"""

import argparse
import csv
import sys
from pathlib import Path

from dotenv import load_dotenv

import screening

DATA_DIR = Path(__file__).parent / "data"
TESTSET_PATH = DATA_DIR / "testset.csv"

csv.field_size_limit(10_000_000)


def load_cvs() -> list[str]:
    with open(TESTSET_PATH, newline="", encoding="utf-8") as f:
        return [row["cv"] for row in csv.DictReader(f)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=15, help="number of CVs to screen")
    args = parser.parse_args()

    load_dotenv()
    screening.init()
    config = screening.fetch_config()
    print(f"Prompt source: {config.source}")

    cvs = load_cvs()[: args.count]
    if not cvs:
        sys.exit("No CVs found. Run prepare_testset.py first.")

    for i, cv in enumerate(cvs, 1):
        result = screening.classify_cv({"cv": cv}, config)
        verdict = "advance" if result.get("overall_match") else "reject"
        print(f"  [{i}/{len(cvs)}] {verdict}")

    print(f"Done. Generated {len(cvs)} traces in Agenta (no feedback attached).")


if __name__ == "__main__":
    main()
