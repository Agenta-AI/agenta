"""Report current OpenRouter recommendations and provider catalog gaps."""

from __future__ import annotations

import argparse
import ast
import json
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ASSETS = REPO_ROOT / "sdks/python/agenta/sdk/utils/assets.py"
CAPABILITIES = REPO_ROOT / "sdks/python/agenta/sdk/agents/capabilities.py"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


def assignment(path: Path, name: str):
    tree = ast.parse(path.read_text())
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if any(
            isinstance(target, ast.Name) and target.id == name for target in targets
        ):
            return ast.literal_eval(node.value)
    raise RuntimeError(f"{name} was not found in {path}")


def fetch_openrouter() -> tuple[str, list[dict]]:
    query = urllib.parse.urlencode(
        {
            "sort": "most-popular",
            "supported_parameters": "tools",
            "output_modalities": "text",
        }
    )
    url = f"{OPENROUTER_MODELS_URL}?{query}"
    request = urllib.request.Request(
        url, headers={"User-Agent": "agenta-model-catalog-audit"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return url, json.load(response)["data"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-size", type=int, default=10)
    parser.add_argument("--default-size", type=int, default=10)
    args = parser.parse_args()

    source_url, live = fetch_openrouter()
    supported = assignment(ASSETS, "supported_llm_models")["openrouter"]
    defaults = assignment(CAPABILITIES, "PROVIDER_DEFAULT_MODELS")["openrouter"]
    ranked = [
        {"id": f"openrouter/{model['id']}", "name": model.get("name") or model["id"]}
        for model in live[: args.catalog_size]
    ]
    ranked_ids = [model["id"] for model in ranked]

    print(
        json.dumps(
            {
                "source": source_url,
                "recommended_defaults": ranked[: args.default_size],
                "catalog": ranked,
                "missing_from_supported": [
                    model for model in ranked if model["id"] not in supported
                ],
                "no_longer_ranked": [
                    model for model in supported if model not in ranked_ids
                ],
                "defaults_match": defaults == ranked_ids[: args.default_size],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
