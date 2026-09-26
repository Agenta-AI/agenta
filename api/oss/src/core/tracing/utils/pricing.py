import re
from functools import lru_cache
from typing import Dict, Iterator, Optional, Tuple

import litellm
from litellm import cost_calculator

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


# Bare family names that harnesses send as the model id (e.g. Claude Code's "sonnet").
MODEL_ALIASES: Dict[str, str] = {
    "sonnet": "claude-sonnet-5",
    "opus": "claude-opus-5",
    "haiku": "claude-haiku-4-5",
}

# Models the bundled litellm price map does not carry yet, as (base key, per-token
# prices). Each entry copies its base's metadata and replaces the prices. Only a price
# from the provider's published list goes here; drop an entry once litellm ships it.
PRICE_MAP_ADDITIONS: Dict[str, Tuple[str, Dict[str, float]]] = {
    # Anthropic list price: $4 input, $20 output, $0.20 cache read, $5 cache write
    # (5-minute), $8 cache write (1-hour) per million tokens. Upstream litellm's price
    # map has the same values.
    "claude-opus-5-5": (
        "claude-opus-5",
        {
            "input_cost_per_token": 4e-06,
            "output_cost_per_token": 2e-05,
            "cache_read_input_token_cost": 2e-07,
            "cache_creation_input_token_cost": 5e-06,
            "cache_creation_input_token_cost_above_1hr": 8e-06,
        },
    ),
}


def _register_price_map_additions() -> None:
    additions = {}
    for model, (base, prices) in PRICE_MAP_ADDITIONS.items():
        base_entry = litellm.model_cost.get(base)
        if model in litellm.model_cost or not isinstance(base_entry, dict):
            continue
        entry = {
            key: value
            for key, value in base_entry.items()
            if key != "deprecation_date" and not key.endswith("_batches")
        }
        entry.update(prices)
        additions[model] = entry

    if not additions:
        return

    # A failed registration leaves these models unpriced; it must not stop the import.
    try:
        litellm.register_model(additions, persist_across_reloads=False)
    except Exception:  # pylint: disable=broad-exception-caught
        log.warn(
            "Failed to add models to the litellm price map", models=list(additions)
        )


_register_price_map_additions()

# Only a prefix litellm knows as a provider is stripped. `my-gateway/gpt-4o` is a custom
# deployment with its own prices, so it must not fall through to the public `gpt-4o` price.
PRICING_PROVIDER_PREFIXES = frozenset(
    str(getattr(provider, "value", provider)).lower()
    for provider in litellm.provider_list
) | {"openrouter"}

_CONTEXT_HINT = re.compile(r"\[[^\]]*\]$")
_DATE_SUFFIX = re.compile(r"-(?:\d{8}|\d{4}-\d{2}-\d{2})$")
_DOTTED_VERSION = re.compile(r"(?<=\d)\.(?=\d)")


def _has_token_price(key: str) -> bool:
    entry = litellm.model_cost.get(key)

    return isinstance(entry, dict) and (
        "input_cost_per_token" in entry or "output_cost_per_token" in entry
    )


def _candidates(model: str) -> Iterator[str]:
    yield model

    name = _CONTEXT_HINT.sub("", model.strip()).lower()
    prefix, separator, rest = name.partition("/")
    bases = (
        [name, rest] if separator and prefix in PRICING_PROVIDER_PREFIXES else [name]
    )

    for base in bases:
        dashed = _DOTTED_VERSION.sub("-", base)
        for candidate in (
            base,
            dashed,
            _DATE_SUFFIX.sub("", base),
            _DATE_SUFFIX.sub("", dashed),
        ):
            yield candidate
            if candidate in MODEL_ALIASES:
                yield MODEL_ALIASES[candidate]

    if prefix != "openrouter":
        yield f"openrouter/{name}"


@lru_cache(maxsize=4096)
def resolve_pricing_model(model: str) -> Optional[str]:
    """Map a reported model name to a litellm price-map key, or None when none applies."""
    for candidate in _candidates(model):
        if _has_token_price(candidate):
            return candidate

    log.warn("No litellm price for model; its spans get no cost", model=model)

    return None


def price_tokens(
    *,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> Tuple[float, float]:
    """(prompt cost, completion cost) in USD, with litellm's inclusive prompt count.

    Every cache write is priced at litellm's 5-minute rate. Anthropic bills 1-hour cache
    writes higher, but the spans do not say which TTL a write used.
    """
    # Cache kwargs only when non-zero, so an uncached span keeps the legacy call shape.
    cache_kwargs = {}
    if cache_read_tokens:
        cache_kwargs["cache_read_input_tokens"] = cache_read_tokens
    if cache_write_tokens:
        cache_kwargs["cache_creation_input_tokens"] = cache_write_tokens

    return cost_calculator.cost_per_token(
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        **cache_kwargs,
    )
