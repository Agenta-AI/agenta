"""Deny-set env seeding (`agenta.sdk.redaction.seed`): selects env var NAMES via
PREFIX/SUFFIX/BLOCKLIST, seeds their VALUES, then ALLOWLIST spares literal values.

PREFIX/SUFFIX/BLOCKLIST default to constants in seed.py (PREFIX default is empty — opt-in
only); each env override (AGENTA_REDACTED_PREFIXES/SUFFIXES/BLOCKLIST) MERGES onto the
default. ALLOWLIST (AGENTA_REDACTED_ALLOWLIST) merges (union) onto the default value-spare
list. All four env vars are read live via os.getenv on every call, so no importlib.reload is
needed — monkeypatch.setenv/delenv is sufficient.
"""

from __future__ import annotations

from agenta.sdk.redaction.seed import curated_env_secret_values, seed_from_request


REPRESENTATIVE_ENV = {
    # Secrets — must be seeded by the default SUFFIX list.
    "AGENTA_STORE_SIGNING_KEY": "signing-key-value-aaaa",
    "GOOGLE_OAUTH_CLIENT_SECRET": "oauth-secret-value-bbbb",
    "AGENTA_AI_SERVICES_REFINE_PROMPT_KEY": "refine-prompt-key-value-cccc",
    "SMTP_PASSWORD": "smtp-password-value-dddd",
    "NGROK_AUTHTOKEN": "ngrok-authtoken-value-eeee",
    "APPLE_KEY_ID": "some-key-id-value-1234",
    "CLOUDFLARE_TURNSTILE_SITE_KEY": "public-site-key-value",
    # Non-secrets — must NOT be seeded (no suffix/prefix/blocklist match by default).
    "SUPERTOKENS_PASSWORD_POLICY": "strong",
    "SUPERTOKENS_PASSWORD_MAX_LENGTH": "64",
    "AGENTA_AUTHN_EMAIL_FROM": "noreply@agenta.ai",
    # Default PREFIX is empty: these are NOT seeded out of the box even though they look
    # provider-ish, because prefix-based selection is opt-in only.
    "POSTGRES_HOST": "db.internal",
    "AWS_REGION": "us-east-1",
    "CLAUDE_CONFIG_PATH": "/root/.claude",
    # Default BLOCKLIST entry — seeded by name even though it matches no suffix.
    "AWS_BEARER_TOKEN_BEDROCK": "bedrock-bearer-token-value-ffff",
}


def _set_env(monkeypatch):
    for name, value in REPRESENTATIVE_ENV.items():
        monkeypatch.setenv(name, value)


class TestCuratedEnvSecretValuesDefaults:
    def test_seeds_secret_shaped_values_via_default_suffixes(self, monkeypatch):
        _set_env(monkeypatch)
        values = curated_env_secret_values()
        for name in [
            "AGENTA_STORE_SIGNING_KEY",
            "GOOGLE_OAUTH_CLIENT_SECRET",
            "AGENTA_AI_SERVICES_REFINE_PROMPT_KEY",
            "SMTP_PASSWORD",
            "NGROK_AUTHTOKEN",
            "APPLE_KEY_ID",
            "CLOUDFLARE_TURNSTILE_SITE_KEY",
        ]:
            assert REPRESENTATIVE_ENV[name] in values, (
                f"expected {name} value to be seeded"
            )

    def test_skips_non_secret_lookalikes(self, monkeypatch):
        _set_env(monkeypatch)
        values = curated_env_secret_values()
        for name in [
            "SUPERTOKENS_PASSWORD_POLICY",
            "SUPERTOKENS_PASSWORD_MAX_LENGTH",
            "AGENTA_AUTHN_EMAIL_FROM",
        ]:
            assert REPRESENTATIVE_ENV[name] not in values, (
                f"{name} value must not be seeded"
            )

    def test_default_prefix_list_is_empty_so_prefix_lookalikes_are_not_seeded(
        self, monkeypatch
    ):
        _set_env(monkeypatch)
        monkeypatch.delenv("AGENTA_REDACTED_PREFIXES", raising=False)
        values = curated_env_secret_values()
        for name in ["POSTGRES_HOST", "AWS_REGION", "CLAUDE_CONFIG_PATH"]:
            assert REPRESENTATIVE_ENV[name] not in values, (
                f"{name} must not be seeded with the default (empty) prefix list"
            )

    def test_aws_bearer_token_bedrock_is_seeded_via_default_blocklist(
        self, monkeypatch
    ):
        # AWS_BEARER_TOKEN_BEDROCK matches no suffix; it is seeded only because it is in the
        # default BLOCKLIST (names, not values).
        _set_env(monkeypatch)
        values = curated_env_secret_values()
        assert REPRESENTATIVE_ENV["AWS_BEARER_TOKEN_BEDROCK"] in values

    def test_end_to_end_redacts_secret_but_not_decoy(self, monkeypatch):
        _set_env(monkeypatch)
        redactor = seed_from_request()
        secret_text = f"leaked: {REPRESENTATIVE_ENV['AGENTA_STORE_SIGNING_KEY']} end"
        decoy_text = f"policy: {REPRESENTATIVE_ENV['SUPERTOKENS_PASSWORD_POLICY']} end"
        assert REPRESENTATIVE_ENV[
            "AGENTA_STORE_SIGNING_KEY"
        ] not in redactor.redact_string(secret_text)
        assert redactor.redact_string(decoy_text) == decoy_text


class TestEnvOverrideMergeSemantics:
    def test_agenta_redacted_prefixes_merges_and_selects_postgres_host(
        self, monkeypatch
    ):
        _set_env(monkeypatch)
        monkeypatch.setenv("AGENTA_REDACTED_PREFIXES", "POSTGRES_")
        values = curated_env_secret_values()
        assert REPRESENTATIVE_ENV["POSTGRES_HOST"] in values
        # Merge, not replace: the default suffix-selected secrets are still seeded too.
        assert REPRESENTATIVE_ENV["AGENTA_STORE_SIGNING_KEY"] in values

    def test_agenta_redacted_suffixes_merges_keeps_default_key_suffix_and_adds_custom(
        self, monkeypatch
    ):
        _set_env(monkeypatch)
        monkeypatch.setenv("MYCORP_MYSECRET", "custom-secret-value-gggg")
        monkeypatch.setenv("AGENTA_REDACTED_SUFFIXES", "_MYSECRET")
        values = curated_env_secret_values()
        # New suffix is additive.
        assert "custom-secret-value-gggg" in values
        # Default suffix (_KEY) still applies — merge, never replace.
        assert REPRESENTATIVE_ENV["AGENTA_STORE_SIGNING_KEY"] in values

    def test_agenta_redacted_blocklist_merges_onto_default_bedrock_entry(
        self, monkeypatch
    ):
        _set_env(monkeypatch)
        monkeypatch.setenv("MYCORP_SPECIAL_VAR", "special-var-value-hhhh")
        monkeypatch.setenv("AGENTA_REDACTED_BLOCKLIST", "MYCORP_SPECIAL_VAR")
        values = curated_env_secret_values()
        assert "special-var-value-hhhh" in values
        # Default blocklist entry (AWS_BEARER_TOKEN_BEDROCK) still seeded — merge, never replace.
        assert REPRESENTATIVE_ENV["AWS_BEARER_TOKEN_BEDROCK"] in values

    def test_agenta_redacted_allowlist_merges_keeps_true_and_spares_mycorp(
        self, monkeypatch
    ):
        _set_env(monkeypatch)
        monkeypatch.setenv("SOME_APP_KEY", "true")
        monkeypatch.setenv("SOME_APP_TOKEN", "mycorp")
        monkeypatch.setenv("AGENTA_REDACTED_ALLOWLIST", "mycorp")
        redactor = seed_from_request()
        # Default allowlist entry ("true") still spared — merge, never replace.
        assert redactor.redact_string("value is true") == "value is true"
        # Operator-added allowlist entry ("mycorp") is also spared.
        assert redactor.redact_string("value is mycorp") == "value is mycorp"


class TestBooleanValuesDoNotPoisonTheDenySet:
    def test_secret_named_var_holding_true_does_not_redact_true_elsewhere(
        self, monkeypatch
    ):
        monkeypatch.setenv("SOME_FEATURE_KEY", "true")
        redactor = seed_from_request()
        # "true" is on the default allowlist, so a secret-named var holding it never seeds it.
        assert (
            redactor.redact_string("flag is true, still true")
            == "flag is true, still true"
        )

    def test_real_secret_value_from_the_same_kind_of_var_is_still_redacted(
        self, monkeypatch
    ):
        monkeypatch.setenv(
            "SOME_FEATURE_KEY", "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"
        )
        redactor = seed_from_request()
        out = redactor.redact_string(
            "leaked: ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a end"
        )
        assert "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a" not in out
        assert "[ag:redacted:secret:" in out
