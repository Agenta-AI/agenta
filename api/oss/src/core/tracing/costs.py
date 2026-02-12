"""
Lightweight LLM cost calculator using models.dev pricing data.

Replaces litellm.cost_calculator to avoid pulling in litellm (~45MB)
and its transitive dependencies (openai, tokenizers, huggingface_hub, etc.).

Caching: uses the app's existing set_cache/get_cache (in-memory + Redis).
"""

import time
from typing import Optional, Tuple, Dict

import httpx

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import set_cache, get_cache

log = get_module_logger(__name__)

_MODELS_DEV_URL = "https://models.dev/api.json"
_CACHE_NAMESPACE = "models_dev_pricing"
_CACHE_TTL_SECONDS = 3600  # 1 hour
_LOCAL_TTL_SECONDS = 300  # 5 minutes

_pricing: Dict[str, dict] = {}
_last_local: float = 0.0


def _build_pricing(catalog: dict) -> Dict[str, dict]:
    """Parse models.dev catalog into a flat model->cost lookup."""
    pricing: Dict[str, dict] = {}
    for provider_id, provider_data in catalog.items():
        models = provider_data.get("models", {})
        for model_id, model_data in models.items():
            cost = model_data.get("cost")
            if cost:
                pricing[model_id] = cost
                pricing[f"{provider_id}/{model_id}"] = cost
    return pricing


def _fetch_from_http() -> Optional[Dict[str, dict]]:
    """Fetch fresh pricing from models.dev."""
    try:
        resp = httpx.get(_MODELS_DEV_URL, timeout=10.0)
        resp.raise_for_status()
        catalog = resp.json()
        return _build_pricing(catalog)
    except Exception:
        log.warning("Failed to fetch models.dev pricing catalog")
        return None


async def _refresh_pricing() -> None:
    """Refresh pricing: try cache (Redis+in-memory) first, fall back to HTTP."""
    global _pricing, _last_local

    # Try existing cache layer (in-memory L1 + Redis L2)
    cached = await get_cache(
        namespace=_CACHE_NAMESPACE,
        key="catalog",
        retry=False,
    )
    if cached and isinstance(cached, dict):
        _pricing = cached
        _last_local = time.monotonic()
        return

    # Fetch from HTTP
    pricing = _fetch_from_http()
    if pricing:
        _pricing = pricing
        _last_local = time.monotonic()
        await set_cache(
            namespace=_CACHE_NAMESPACE,
            key="catalog",
            value=pricing,
            ttl=_CACHE_TTL_SECONDS,
        )


async def _get_pricing() -> Dict[str, dict]:
    """Return cached pricing, refreshing if local cache is stale."""
    now = time.monotonic()
    if now - _last_local > _LOCAL_TTL_SECONDS:
        await _refresh_pricing()
    return _pricing


async def cost_per_token(
    *,
    model: Optional[str],
    prompt_tokens: float,
    completion_tokens: float,
) -> Optional[Tuple[float, float]]:
    """
    Calculate cost for the given model and token counts.

    Returns (prompt_cost, completion_cost) in USD, or None if model not found.
    Prices from models.dev are in USD per 1M tokens.
    """
    if not model:
        return None

    pricing = await _get_pricing()

    cost = pricing.get(model)
    if not cost:
        # Try common patterns: strip provider prefix, etc.
        if "/" in model:
            _, short = model.rsplit("/", 1)
            cost = pricing.get(short)
        if not cost:
            return None

    input_price = cost.get("input", 0)  # USD per 1M tokens
    output_price = cost.get("output", 0)

    prompt_cost = prompt_tokens * input_price / 1_000_000
    completion_cost = completion_tokens * output_price / 1_000_000

    return (prompt_cost, completion_cost)
