"""Provider-key -> harness env-var mapping.

The harness authenticates with the project's vault provider keys, injected as the env vars
each provider's SDK reads. If a name here drifts from what the harness expects, auth fails
silently and the run falls back to login/OAuth, so the table is worth a guard.
"""

from __future__ import annotations

from oss.src.agent.secrets import _PROVIDER_ENV_VARS


def test_standard_providers_map_to_expected_env_vars():
    assert _PROVIDER_ENV_VARS["openai"] == "OPENAI_API_KEY"
    assert _PROVIDER_ENV_VARS["anthropic"] == "ANTHROPIC_API_KEY"
    assert _PROVIDER_ENV_VARS["gemini"] == "GEMINI_API_KEY"
    assert _PROVIDER_ENV_VARS["groq"] == "GROQ_API_KEY"
    assert _PROVIDER_ENV_VARS["together_ai"] == "TOGETHER_API_KEY"
    assert _PROVIDER_ENV_VARS["openrouter"] == "OPENROUTER_API_KEY"


def test_both_mistral_spellings_share_one_env_var():
    assert _PROVIDER_ENV_VARS["mistral"] == "MISTRAL_API_KEY"
    assert _PROVIDER_ENV_VARS["mistralai"] == "MISTRAL_API_KEY"
