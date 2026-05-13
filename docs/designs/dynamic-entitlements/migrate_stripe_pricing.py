#!/usr/bin/env python3
"""Convert the legacy `STRIPE_PRICING` / `AGENTA_PRICING` env value to the
canonical `AGENTA_BILLING_PRICING` shape consumed by
`ee.src.core.subscriptions.settings`.

Old (flat) shape — one entry per plan, top-level keys are meter slugs:

    {
        "cloud_v0_pro": {
            "base":   {"price": "price_base_1",   "quantity": 1},
            "users":  {"price": "price_users_1",  "quantity": 1},
            "traces": {"price": "price_traces_1"}
        }
    }

New (canonical) shape — `line_items` is what Stripe sees on checkout;
`meters` is how `meters/service.py` finds the price ID for a given meter
(counter/gauge slug) when reporting usage.

    {
        "cloud_v0_pro": {
            "stripe": {
                "line_items": [
                    {"price": "price_base_1",   "quantity": 1},
                    {"price": "price_users_1",  "quantity": 1},
                    {"price": "price_traces_1"}
                ],
                "meters": {
                    "users":  {"price": "price_users_1"},
                    "traces": {"price": "price_traces_1"}
                }
            }
        },
        "cloud_v0_hobby": {"free": true}
    }

Usage:

    # From a file
    python migrate_stripe_pricing.py --in stripe_pricing.json --out billing_pricing.json

    # From an env var (with optional --free to mark a plan as the free fallback)
    STRIPE_PRICING='{"cloud_v0_pro": {...}}' python migrate_stripe_pricing.py \\
        --env STRIPE_PRICING --free cloud_v0_hobby

The `--free <slug>` flag adds `{"free": true}` for the given plan slug if it
isn't already present — there must be exactly one free plan in the canonical
pricing for downgrade/cancel flows to work.

`line_items` is the list of meter sub-entries that have a `"price"` field.
Meters without a price (e.g. retention buckets) are skipped. The `quantity`
defaults to 1 for entries that don't specify one; pass `--no-default-quantity`
to disable that.
"""

import argparse
import json
import os
import sys
from typing import Any


# Top-level keys in a legacy plan entry that are treated as Stripe-billable
# meters. Everything that has a `price` is a line item; the entries we map into
# `stripe.meters` are the ones reported on by `meters/service.py` (gauges +
# tiered counters with per-unit prices).
_METER_KEYS_FOR_REPORTING = {"users", "traces"}


def _convert_plan(
    slug: str,
    old: dict[str, Any],
    *,
    default_quantity: bool,
) -> dict[str, Any]:
    line_items: list[dict[str, Any]] = []
    meters: dict[str, dict[str, str]] = {}

    for meter_key, meter_block in old.items():
        if not isinstance(meter_block, dict):
            raise ValueError(
                f"{slug}.{meter_key}: expected object, got {type(meter_block).__name__}"
            )

        price = meter_block.get("price")
        if not price:
            # No price ID → not a Stripe line item; skip.
            continue

        item: dict[str, Any] = {"price": price}
        if "quantity" in meter_block:
            item["quantity"] = meter_block["quantity"]
        elif default_quantity:
            item["quantity"] = 1
        line_items.append(item)

        if meter_key in _METER_KEYS_FOR_REPORTING:
            meters[meter_key] = {"price": price}

    out: dict[str, Any] = {"stripe": {"line_items": line_items}}
    if meters:
        out["stripe"]["meters"] = meters
    return out


def convert(
    legacy: dict[str, Any],
    *,
    free_slug: str | None = None,
    default_quantity: bool = True,
) -> dict[str, Any]:
    if not isinstance(legacy, dict):
        raise ValueError("Top-level legacy pricing must be a JSON object")

    result: dict[str, Any] = {}
    for slug, plan_block in legacy.items():
        if not isinstance(plan_block, dict):
            raise ValueError(f"{slug}: plan entry must be a JSON object")
        result[slug] = _convert_plan(
            slug, plan_block, default_quantity=default_quantity
        )

    if free_slug:
        if free_slug not in result:
            result[free_slug] = {}
        result[free_slug]["free"] = True

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
        "--no-default-quantity",
        dest="default_quantity",
        action="store_false",
        help="Do not inject quantity=1 for line items that omit it",
    )
    parser.add_argument("--pretty", action="store_true", help="Indent JSON output")
    args = parser.parse_args()

    legacy = _read_input(args)
    converted = convert(
        legacy,
        free_slug=args.free_slug,
        default_quantity=args.default_quantity,
    )
    _write_output(args, converted)


if __name__ == "__main__":
    main()
