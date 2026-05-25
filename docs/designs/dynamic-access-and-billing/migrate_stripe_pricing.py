#!/usr/bin/env python3
"""Annotate existing `STRIPE_PRICING` / `AGENTA_PRICING` JSON with the two
reserved markers that the new canonical `AGENTA_BILLING_PRICING` schema
adds: `{"free": true}` and `{"trial": N}`.

The canonical schema is intentionally the same as the old shape — top-level
keys inside a plan entry are Stripe-side meter slot names (`"users"`,
`"traces"`, …), each carrying `{"price": ..., "quantity"?}`. The only
additions are the two reserved top-level markers:

- `"free": true` — marks this plan as the free / downgrade fallback
  (exactly one entry across the whole pricing map may carry this).
- `"trial": N` — marks this plan as the reverse-trial plan with duration
  `N` days (exactly one entry across the whole pricing map may carry this).

Because the old shape passes through verbatim, an operator who only needs
to add the markers can just edit their JSON by hand. This script is a
small convenience for scripted deployments — it reads the existing JSON,
adds the markers via CLI flags, and emits the result.

Usage:

    # Annotate from a file
    python migrate_stripe_pricing.py --in stripe_pricing.json \\
        --free cloud_v0_hobby \\
        --trial cloud_v0_pro:90 \\
        --out billing_pricing.json

    # Annotate from an env var
    STRIPE_PRICING='{"cloud_v0_pro": {...}}' python migrate_stripe_pricing.py \\
        --env STRIPE_PRICING --free cloud_v0_hobby

Without `--free` and `--trial`, the script is a pure pass-through (no
reshape happens). It does not validate the canonical schema — point
`AGENTA_BILLING_PRICING` at the result and let the API's startup
validator do that.
"""

import argparse
import json
import os
import sys
from typing import Any


def annotate(
    pricing: dict[str, Any],
    *,
    free_slug: str | None = None,
    trial: tuple[str, int] | None = None,
) -> dict[str, Any]:
    """Add the `free` and `trial` markers to a copy of the pricing dict."""
    if not isinstance(pricing, dict):
        raise ValueError("Top-level pricing must be a JSON object")

    result: dict[str, Any] = {slug: dict(entry) for slug, entry in pricing.items()}

    if free_slug:
        result.setdefault(free_slug, {})
        result[free_slug]["free"] = True

    if trial:
        trial_slug, trial_days = trial
        result.setdefault(trial_slug, {})
        result[trial_slug]["trial"] = trial_days

    return result


def _read_input(args: argparse.Namespace) -> dict[str, Any]:
    if args.env:
        raw = os.environ.get(args.env)
        if not raw:
            raise SystemExit(f"env var {args.env} is empty or unset")
        return json.loads(raw)
    if args.in_file:
        with open(args.in_file, "r") as fh:
            return json.load(fh)
    raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit("no input provided (use --env, --in, or stdin)")
    return json.loads(raw)


def _write_output(args: argparse.Namespace, data: dict[str, Any]) -> None:
    text = json.dumps(data, indent=2 if args.pretty else None, sort_keys=True)
    if args.out_file:
        with open(args.out_file, "w") as fh:
            fh.write(text)
            fh.write("\n")
    else:
        print(text)


def _parse_trial(raw: str | None) -> tuple[str, int] | None:
    """Parse the `--trial <slug>:<days>` form into `(slug, days)`."""
    if not raw:
        return None
    if ":" not in raw:
        raise SystemExit("--trial must be in the form '<plan_slug>:<days>'")
    slug, _, days_str = raw.partition(":")
    if not slug:
        raise SystemExit("--trial: missing plan slug")
    try:
        days = int(days_str)
    except ValueError as e:
        raise SystemExit(f"--trial: days must be an integer, got {days_str!r}") from e
    if days <= 0:
        raise SystemExit(f"--trial: days must be positive, got {days}")
    return slug, days


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--env", help="Read JSON from this env var (e.g. STRIPE_PRICING)"
    )
    parser.add_argument("--in", dest="in_file", help="Read JSON from this file")
    parser.add_argument(
        "--out", dest="out_file", help="Write JSON to this file (default: stdout)"
    )
    parser.add_argument(
        "--free", dest="free_slug", help="Mark this plan slug as the free fallback"
    )
    parser.add_argument(
        "--trial",
        dest="trial",
        help="Mark this plan as the reverse-trial plan: '<plan_slug>:<days>'",
    )
    parser.add_argument("--pretty", action="store_true", help="Indent JSON output")
    args = parser.parse_args()

    pricing = _read_input(args)
    annotated = annotate(
        pricing,
        free_slug=args.free_slug,
        trial=_parse_trial(args.trial),
    )
    _write_output(args, annotated)


if __name__ == "__main__":
    main()
