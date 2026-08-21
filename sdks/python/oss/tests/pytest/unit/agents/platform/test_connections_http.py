"""``VaultConnectionResolver`` over the existing ``GET /secrets/`` response."""

from __future__ import annotations

import pytest

from agenta.sdk.agents.connections import (
    AmbiguousConnectionError,
    ConnectionNotFoundError,
    ConnectionResolutionError,
    InvalidConnectionConfigurationError,
    MissingCredentialError,
    MissingProviderError,
    ModelRef,
    ProviderMismatchError,
    RuntimeAuthContext,
)
from agenta.sdk.agents.platform import PlatformConnection, VaultConnectionResolver
from agenta.sdk.agents.platform import connections


def _credential_environment(resolved) -> dict[str, str]:
    return {item.binding.name: item.value for item in resolved.credentials}


def _model(
    slug: str | None = "openai", provider: str = "openai", model: str = "gpt-5.5"
) -> ModelRef:
    connection = {"mode": "agenta"}
    if slug is not None:
        connection["slug"] = slug
    return ModelRef(provider=provider, model=model, connection=connection)


def _context() -> RuntimeAuthContext:
    return RuntimeAuthContext(harness="pi_core", backend="local")


def _provider_key(
    name: str,
    provider: str,
    key: str,
    *,
    slug: str | None = None,
    models: list[str] | None = None,
    harnesses: list[str] | None = None,
) -> dict:
    data: dict = {"kind": provider, "provider": {"key": key}}
    if models is not None:
        data["models"] = [{"slug": model} for model in models]
    if harnesses is not None:
        data["harnesses"] = harnesses
    secret = {"kind": "provider_key", "header": {"name": name}, "data": data}
    # Records created before named connections have no slug at all.
    if slug is not None:
        secret["slug"] = slug
    return secret


def _custom_provider(
    name: str,
    kind: str,
    *,
    key: str | None = None,
    url: str | None = None,
    version: str | None = None,
    extras: dict | None = None,
    models: list[str] | None = None,
    slug: str | None = None,
    model_keys: list[str] | None = None,
) -> dict:
    secret = {
        "kind": "custom_provider",
        "header": {"name": name},
        "data": {
            "kind": kind,
            "provider_slug": name,
            "provider": {
                "url": url,
                "version": version,
                "key": key,
                "extras": extras or {},
            },
            "models": [{"slug": m} for m in (models or ["my-model"])],
            "model_keys": model_keys
            if model_keys is not None
            else [f"{name}/{kind}/{m}" for m in (models or ["my-model"])],
        },
    }
    # Records created before named connections have no slug and are addressed by their name.
    if slug is not None:
        secret["slug"] = slug
    return secret


async def test_resolve_fetches_secrets_and_selects_one_key(fake_http, connection):
    # Provider keys are addressed by their PROVIDER; header.name is display-only, never a slug.
    capture = fake_http(
        connections,
        payload=[
            _provider_key("My OpenAI key", "openai", "sk-prod"),
            _provider_key("My Anthropic key", "anthropic", "sk-ant"),
        ],
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("openai"), context=_context()
    )

    assert resolved.provider == "openai"
    assert resolved.model == "gpt-5.5"
    assert resolved.deployment == "direct"
    assert resolved.credential_mode == "env"
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-prod"}
    assert resolved.input_modalities == ["text", "image"]
    assert capture["method"] == "GET"
    assert capture["url"] == "https://api.x/api/secrets/"
    assert capture["headers"]["Authorization"] == "Access tok"
    assert "json" not in capture


async def test_self_managed_short_circuits_without_api_base(fake_http):
    resolved = await VaultConnectionResolver(PlatformConnection()).resolve(
        model=ModelRef(
            provider="openai", model="gpt-5.5", connection={"mode": "self_managed"}
        ),
        context=_context(),
    )
    assert resolved.credential_mode == "runtime_provided"
    assert _credential_environment(resolved) == {}
    assert resolved.input_modalities == ["text", "image"]


async def test_default_connection_requires_unique_provider_match(fake_http, connection):
    fake_http(connections, payload=[_provider_key("default", "openai", "sk-default")])
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(slug=None), context=_context()
    )
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-default"}


async def test_managed_connection_with_empty_key_fails_closed(fake_http, connection):
    fake_http(connections, payload=[_provider_key("default", "openai", "")])
    with pytest.raises(MissingCredentialError, match="self_managed"):
        await VaultConnectionResolver(connection).resolve(
            model=_model(slug=None), context=_context()
        )


async def test_empty_vault_reports_missing_not_ambiguous(fake_http, connection):
    fake_http(connections, payload=[])
    with pytest.raises(MissingCredentialError):
        await VaultConnectionResolver(connection).resolve(
            model=_model(slug=None), context=_context()
        )


async def test_default_connection_ambiguous(fake_http, connection):
    fake_http(
        connections,
        payload=[
            _provider_key("openai-a", "openai", "sk-a"),
            _provider_key("openai-b", "openai", "sk-b"),
        ],
    )
    with pytest.raises(AmbiguousConnectionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model(slug=None), context=_context()
        )


async def test_default_connection_picks_the_one_declaring_the_model(
    fake_http, connection
):
    # A project may hold two keys for one provider, and a new app's config is slug-less. When
    # exactly one of those connections saved the requested model, that is the connection the
    # picker offered it from — resolve it instead of failing ambiguous.
    fake_http(
        connections,
        payload=[
            _provider_key("openai-a", "openai", "sk-a", slug="a", models=["gpt-4o"]),
            _provider_key("openai-b", "openai", "sk-b", slug="b", models=["gpt-5.5"]),
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(slug=None), context=_context()
    )
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-b"}


async def test_an_explicit_model_declaration_beats_a_connection_with_no_list(
    fake_http, connection
):
    # A connection that saved no list only implies the model (it means "use Agenta's defaults");
    # one that saved it claims it outright. The explicit claim wins the tie.
    fake_http(
        connections,
        payload=[
            _provider_key("openai-a", "openai", "sk-a", slug="a"),
            _provider_key("openai-b", "openai", "sk-b", slug="b", models=["gpt-5.5"]),
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(slug=None), context=_context()
    )
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-b"}


async def test_two_connections_declaring_the_same_model_stay_ambiguous(
    fake_http, connection
):
    # Narrowing only resolves what is unambiguous; two connections claiming the same model still
    # fail loud rather than picking one by iteration order.
    fake_http(
        connections,
        payload=[
            _provider_key("openai-a", "openai", "sk-a", slug="a", models=["gpt-5.5"]),
            _provider_key("openai-b", "openai", "sk-b", slug="b", models=["gpt-5.5"]),
        ],
    )
    with pytest.raises(AmbiguousConnectionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model(slug=None), context=_context()
        )


async def test_ambiguous_default_is_a_client_error_naming_the_candidates(
    fake_http, connection
):
    # The invoke remap reads `status_code` off the exception; without one this surfaced as a 500
    # server fault. It is a config problem, and "name one in the config" is only actionable when
    # the message says which names exist.
    fake_http(
        connections,
        payload=[
            _provider_key("openai-a", "openai", "sk-a", slug="openai-a"),
            _provider_key("openai-b", "openai", "sk-b", slug="openai-b"),
        ],
    )
    with pytest.raises(AmbiguousConnectionError) as exc:
        await VaultConnectionResolver(connection).resolve(
            model=_model(slug=None), context=_context()
        )
    assert exc.value.status_code == 422
    assert "openai-a" in str(exc.value) and "openai-b" in str(exc.value)


async def test_bare_model_without_provider_fails_loud(fake_http, connection):
    # F-017: a bare model id (no `provider/` prefix) that matches no vault candidate by model
    # id AND is absent from the supported-models catalog has no provider to look a credential
    # up against. It must fail loud with an actionable message, not degrade silently to
    # no-credential. On a Pi harness the hint suggests an openai/ prefix.
    fake_http(connections, payload=[_provider_key("openai-prod", "openai", "sk-prod")])
    with pytest.raises(MissingProviderError) as exc:
        await VaultConnectionResolver(connection).resolve(
            model=ModelRef.coerce("unknown-model-x"), context=_context()
        )
    assert "provider prefix" in str(exc.value)
    assert "openai/unknown-model-x" in str(exc.value)


async def test_bare_catalog_model_infers_provider(fake_http, connection):
    # A bare id listed under exactly one provider in the supported-models catalog is
    # unambiguous: the provider is inferred instead of failing loud on the missing prefix.
    fake_http(connections, payload=[_provider_key("openai-prod", "openai", "sk-prod")])
    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef.coerce("gpt-4o-mini"), context=_context()
    )
    assert resolved.provider == "openai"
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-prod"}


async def test_missing_provider_hint_is_harness_correct_for_claude(
    fake_http, connection
):
    # F-031: the missing-provider hint must name a harness-REACHABLE provider. On a Claude
    # harness (Anthropic only) an unrecognized bare id must read "anthropic/<m>", never
    # "openai/<m>" (which Claude cannot reach). Use a non-alias bare id so it still fails loud.
    fake_http(
        connections, payload=[_provider_key("anthropic-prod", "anthropic", "sk-ant")]
    )
    with pytest.raises(MissingProviderError) as exc:
        await VaultConnectionResolver(connection).resolve(
            model=ModelRef.coerce("some-unknown-model"),
            context=RuntimeAuthContext(harness="claude"),
        )
    message = str(exc.value)
    assert "anthropic/some-unknown-model" in message
    assert "openai/" not in message


async def test_bare_claude_alias_resolves_to_anthropic(fake_http, connection):
    # F-031: a bare Claude alias from the curated Claude alias list is unambiguously Anthropic,
    # so the F-017 prefix rule must NOT reject it. It resolves against the vault's anthropic key
    # the same way the documented `anthropic/haiku` form does, instead of failing loud.
    fake_http(
        connections, payload=[_provider_key("anthropic-prod", "anthropic", "sk-ant")]
    )
    for alias in ("haiku", "sonnet", "opus[1m]"):
        resolved = await VaultConnectionResolver(connection).resolve(
            model=ModelRef.coerce(alias),
            context=RuntimeAuthContext(harness="claude"),
        )
        assert resolved.provider == "anthropic", alias
        assert resolved.model == alias, alias
        assert _credential_environment(resolved) == {"ANTHROPIC_API_KEY": "sk-ant"}, (
            alias
        )
        assert resolved.input_modalities == ["text", "image"], alias


async def test_bare_claude_dated_id_resolves_to_anthropic(fake_http, connection):
    # F-031: a bare dated Anthropic id (claude-opus-4-8) is also unambiguously Anthropic via the
    # claude-* naming convention, so it resolves rather than failing loud on a missing prefix.
    fake_http(
        connections, payload=[_provider_key("anthropic-prod", "anthropic", "sk-ant")]
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef.coerce("claude-opus-4-8"),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.provider == "anthropic"
    assert resolved.model == "claude-opus-4-8"


async def test_bare_model_matching_a_candidate_infers_the_provider(
    fake_http, connection
):
    # F-017: a bare model id still resolves when a vault candidate matches it by model id; the
    # provider is then inferred from the matched candidate. Only the no-match case fails loud.
    fake_http(
        connections,
        payload=[
            _custom_provider("my-gw", "openai", key="sk-gw", models=["gpt-4o-mini"])
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef.coerce("gpt-4o-mini"), context=_context()
    )
    assert resolved.credential_mode == "env"


@pytest.mark.parametrize(
    ("provider", "environment_name"),
    [
        ("openai", "OPENAI_API_KEY"),
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("openrouter", "OPENROUTER_API_KEY"),
    ],
)
async def test_known_direct_custom_provider_uses_direct_deployment(
    fake_http, connection, provider, environment_name
):
    endpoint = "https://93.184.216.34/v1"
    model_id = "vendor/model-v1"
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "custom-direct",
                provider,
                key="provider-key",
                url=endpoint,
                models=[model_id],
            )
        ],
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("custom-direct", provider=provider, model=model_id),
        context=_context(),
    )

    assert resolved.provider == provider
    assert resolved.deployment == "direct"
    assert resolved.model == model_id
    assert resolved.input_modalities is None
    assert resolved.endpoint.base_url == endpoint
    if hasattr(resolved, "plaintext_environment"):
        environment = resolved.plaintext_environment()
    else:
        environment = resolved.env
    assert environment == {environment_name: "provider-key"}


async def test_missing_named_connection_fails_loud(fake_http, connection):
    fake_http(connections, payload=[_provider_key("openai-prod", "openai", "sk-prod")])
    with pytest.raises(ConnectionNotFoundError):
        await VaultConnectionResolver(connection).resolve(
            model=_model("missing"), context=_context()
        )


async def test_provider_mismatch_fails_loud(fake_http, connection):
    fake_http(
        connections, payload=[_provider_key("anthropic-prod", "anthropic", "sk-ant")]
    )
    with pytest.raises(ProviderMismatchError):
        await VaultConnectionResolver(connection).resolve(
            model=_model("anthropic", provider="openai"), context=_context()
        )


async def test_custom_provider_snake_case_extras_normalize_for_bedrock(
    fake_http, connection
):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-bedrock",
                "bedrock",
                extras={
                    "aws_region_name": "us-east-1",
                    "aws_access_key_id": "AKIA",
                    "aws_secret_access_key": "secret",
                    "aws_session_token": "token",
                },
                models=["anthropic.claude-3-5-sonnet"],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(
            "my-bedrock", provider="anthropic", model="anthropic.claude-3-5-sonnet"
        ),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.provider == "anthropic"
    assert resolved.model == "anthropic.claude-3-5-sonnet"
    assert resolved.deployment == "bedrock"
    assert _credential_environment(resolved) == {
        "AWS_ACCESS_KEY_ID": "AKIA",
        "AWS_SECRET_ACCESS_KEY": "secret",
        "AWS_SESSION_TOKEN": "token",
    }
    assert resolved.environment == {"AWS_REGION": "us-east-1"}
    assert {item.usage for item in resolved.credentials} == {"local_use"}
    assert resolved.endpoint.region == "us-east-1"


async def test_bedrock_bearer_is_opaque_http_with_regional_endpoint(
    fake_http, connection
):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-bedrock",
                "bedrock",
                extras={
                    "aws_region_name": "eu-west-1",
                    "aws_bearer_token_bedrock": "bearer-token",
                },
                models=["anthropic.claude-3-5-sonnet"],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(
            "my-bedrock", provider="anthropic", model="anthropic.claude-3-5-sonnet"
        ),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.endpoint.base_url == (
        "https://bedrock-runtime.eu-west-1.amazonaws.com"
    )
    assert _credential_environment(resolved) == {
        "AWS_BEARER_TOKEN_BEDROCK": "bearer-token"
    }
    assert [item.usage for item in resolved.credentials] == ["opaque_http"]


async def test_custom_provider_vertex_snake_case_extras(fake_http, connection):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-vertex",
                "vertex_ai",
                extras={
                    "vertex_ai_project": "proj",
                    "vertex_ai_location": "us-central1",
                    "vertex_ai_credentials": "/adc.json",
                },
                models=["claude-sonnet-4"],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("my-vertex", provider="anthropic", model="claude-sonnet-4"),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.deployment == "vertex_ai"
    assert _credential_environment(resolved) == {
        "GOOGLE_APPLICATION_CREDENTIALS": "/adc.json",
    }
    assert resolved.environment == {
        "GOOGLE_CLOUD_PROJECT": "proj",
        "GOOGLE_CLOUD_LOCATION": "us-central1",
    }
    assert [item.usage for item in resolved.credentials] == ["local_use"]


async def test_vertex_api_key_mode_is_rejected_as_out_of_scope(fake_http, connection):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "vertex-key",
                "vertex_ai",
                extras={
                    "vertex_ai_location": "us-central1",
                    "GOOGLE_CLOUD_API_KEY": "vertex-key-value",
                },
                models=["gemini-model"],
            )
        ],
    )
    with pytest.raises(
        InvalidConnectionConfigurationError, match="Vertex API-key authentication"
    ):
        await VaultConnectionResolver(connection).resolve(
            model=_model("vertex-key", provider="gemini", model="gemini-model"),
            context=RuntimeAuthContext(harness="pi_core"),
        )


async def test_custom_gateway_api_key_from_extras_and_endpoint(fake_http, connection):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "anthropic-gw",
                "custom",
                # Literal public IP so the SSRF guard's range check runs with no live DNS.
                url="https://93.184.216.34/v1",
                extras={"api_key": "sk-gw"},
                models=["gpt-5.5"],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("anthropic-gw", provider="anthropic", model="gpt-5.5"),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.deployment == "custom"
    assert _credential_environment(resolved) == {"ANTHROPIC_API_KEY": "sk-gw"}
    assert resolved.endpoint.base_url == "https://93.184.216.34/v1"


async def test_custom_provider_private_url_fails_loud_not_dropped(
    fake_http, connection
):
    # Decision 4: a chosen named custom connection whose endpoint is blocked must fail loud, not
    # silently continue endpoint-less onto a provider default. The error names the slug, points
    # at AGENTA_INSECURE_EGRESS_ALLOWED, and never carries the API key.
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "internal-gw",
                "custom",
                url="http://169.254.169.254/v1",
                extras={"api_key": "sk-gw"},
                models=["gpt-5.5"],
            )
        ],
    )
    with pytest.raises(ConnectionResolutionError) as exc:
        await VaultConnectionResolver(connection).resolve(
            model=_model("internal-gw", provider="anthropic", model="gpt-5.5"),
            context=RuntimeAuthContext(harness="claude"),
        )
    message = str(exc.value)
    assert "internal-gw" in message
    assert "AGENTA_INSECURE_EGRESS_ALLOWED" in message
    assert "sk-gw" not in message


async def test_custom_provider_loopback_url_fails_loud_not_dropped(
    fake_http, connection
):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "loopback-gw",
                "custom",
                url="https://127.0.0.1/v1",
                extras={"api_key": "sk-gw"},
                models=["gpt-5.5"],
            )
        ],
    )
    with pytest.raises(ConnectionResolutionError) as exc:
        await VaultConnectionResolver(connection).resolve(
            model=_model("loopback-gw", provider="anthropic", model="gpt-5.5"),
            context=RuntimeAuthContext(harness="claude"),
        )
    assert "loopback-gw" in str(exc.value)


async def test_custom_provider_ssrf_guard_defaults_secure(fake_http, connection):
    from agenta.sdk.agents.platform import connections as connections_module

    assert connections_module.assert_endpoint_url_allowed.__module__.endswith(
        "utils.net"
    )

    fake_http(
        connections,
        payload=[
            _custom_provider(
                "private-gw",
                "custom",
                url="http://10.0.0.5/v1",
                extras={"api_key": "sk-gw"},
                models=["gpt-5.5"],
            )
        ],
    )
    # Blocked by default (secure) — and a chosen custom connection fails loud rather than
    # continuing endpoint-less.
    with pytest.raises(ConnectionResolutionError) as exc:
        await VaultConnectionResolver(connection).resolve(
            model=_model("private-gw", provider="anthropic", model="gpt-5.5"),
            context=RuntimeAuthContext(harness="claude"),
        )
    assert "AGENTA_INSECURE_EGRESS_ALLOWED" in str(exc.value)


async def test_openai_compatible_custom_normalizes_to_openai(fake_http, connection):
    # Decision 2: a provider-less named custom connection resolves to the openai provider family,
    # keeps deployment=custom and the exact model id + endpoint, and routes its key through
    # OPENAI_API_KEY only (the family's canonical env var). The connection slug stays identity,
    # never the provider family.
    endpoint = "https://93.184.216.34/v1"
    model_id = "qwen2.5-coder:7b"
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-ollama",
                "custom",
                key="sk-oai-compatible",
                url=endpoint,
                models=[model_id],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef(
            model=model_id, connection={"mode": "agenta", "slug": "my-ollama"}
        ),
        context=_context(),
    )
    assert resolved.provider == "openai"
    assert resolved.deployment == "custom"
    assert resolved.model == model_id
    assert resolved.endpoint.base_url == endpoint
    assert resolved.credential_mode == "env"
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-oai-compatible"}


async def test_openai_compatible_custom_missing_url_fails_loud(fake_http, connection):
    # Decision 4: an explicit named custom connection with no base URL fails loud (naming the
    # slug), rather than resolving with endpoint=None and letting the harness pick a default.
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-ollama",
                "custom",
                key="sk-oai-compatible",
                url=None,
                models=["qwen2.5-coder:7b"],
            )
        ],
    )
    with pytest.raises(ConnectionResolutionError) as exc:
        await VaultConnectionResolver(connection).resolve(
            model=ModelRef(
                model="qwen2.5-coder:7b",
                connection={"mode": "agenta", "slug": "my-ollama"},
            ),
            context=_context(),
        )
    message = str(exc.value)
    assert "my-ollama" in message
    assert "sk-oai-compatible" not in message


async def test_full_custom_model_key_selects_and_strips_to_backend_model(
    fake_http, connection
):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-bedrock",
                "bedrock",
                extras={
                    "aws_access_key_id": "AKIA",
                    "aws_secret_access_key": "secret",
                    "aws_region_name": "us-east-1",
                },
                models=["anthropic.claude-x"],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef.coerce("my-bedrock/bedrock/anthropic.claude-x"),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.model == "anthropic.claude-x"
    assert resolved.deployment == "bedrock"


# ------------------------------------------ namespaced custom model keys (with a provider)

_GATEWAY_URL = "https://93.184.216.34/v1"
_BACKEND_MODEL = "vertex_ai/gemini-3.6-flash"


def _starter_credits(*, name: str = "Starter credits", model_keys=None) -> dict:
    """The seeded OpenAI-compatible gateway connection, addressed by its stable slug.

    Its stored ``model_keys`` are namespaced ``<name>/custom/<backend model>`` and carry no
    provider prefix, which is what the playground writes into the committed config.
    """
    return _custom_provider(
        name,
        "custom",
        key="sk-gateway",
        url=_GATEWAY_URL,
        models=[_BACKEND_MODEL],
        slug="starter-credits",
        model_keys=model_keys,
    )


async def test_namespaced_custom_model_key_strips_when_a_provider_is_set(
    fake_http, connection
):
    # The playground commits provider="openai" alongside the namespaced model id. The stored key
    # has no provider prefix, so matching and stripping must both compare the unprefixed
    # spelling; otherwise the connection matches but the upstream is asked for a model literally
    # named "Starter credits/custom/vertex_ai/gemini-3.6-flash".
    fake_http(connections, payload=[_starter_credits()])

    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef(
            provider="openai",
            model=f"Starter credits/custom/{_BACKEND_MODEL}",
            connection={"mode": "agenta", "slug": "starter-credits"},
        ),
        context=_context(),
    )

    assert resolved.model == _BACKEND_MODEL
    assert resolved.provider == "openai"
    assert resolved.deployment == "custom"
    assert resolved.endpoint.base_url == _GATEWAY_URL


async def test_namespaced_custom_model_key_strips_without_a_provider(
    fake_http, connection
):
    # The same config with no provider set already worked; pin it so the fix keeps both
    # spellings resolving to the same backend model id.
    fake_http(connections, payload=[_starter_credits()])

    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef(
            model=f"Starter credits/custom/{_BACKEND_MODEL}",
            connection={"mode": "agenta", "slug": "starter-credits"},
        ),
        context=_context(),
    )

    assert resolved.model == _BACKEND_MODEL
    assert resolved.provider == "openai"


async def test_legacy_none_namespaced_custom_model_key_strips(fake_http, connection):
    # Rows written before the connection carried a name are namespaced with the literal
    # "None"; they must strip the same way.
    legacy_key = f"None/custom/{_BACKEND_MODEL}"
    fake_http(connections, payload=[_starter_credits(model_keys=[legacy_key])])

    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef(
            provider="openai",
            model=legacy_key,
            connection={"mode": "agenta", "slug": "starter-credits"},
        ),
        context=_context(),
    )

    assert resolved.model == _BACKEND_MODEL


async def test_bare_backend_model_id_is_left_untouched(fake_http, connection):
    # A request that already names the backend model (slashes and all) must pass through
    # unchanged: there is no namespace to strip, and nothing may be cut off the front.
    fake_http(connections, payload=[_starter_credits()])

    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef(
            provider="openai",
            model=_BACKEND_MODEL,
            connection={"mode": "agenta", "slug": "starter-credits"},
        ),
        context=_context(),
    )

    assert resolved.model == _BACKEND_MODEL


async def test_provider_key_model_id_is_unaffected(fake_http, connection):
    # A plain provider key stores no namespaced model keys; its model id must survive verbatim.
    fake_http(
        connections, payload=[_provider_key("My OpenAI key", "openai", "sk-prod")]
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("openai", provider="openai", model="gpt-5.5"),
        context=_context(),
    )

    assert resolved.model == "gpt-5.5"
    assert resolved.deployment == "direct"


async def test_resolve_fails_loud_on_http_error(fake_http, connection):
    fake_http(connections, status=404)
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model("missing"), context=_context()
        )


async def test_resolve_fails_loud_on_network_exception(fake_http, connection):
    fake_http(connections, raises=RuntimeError("network down"))
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model(), context=_context()
        )


async def test_resolve_without_api_base_fails_loud(fake_http):
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(PlatformConnection()).resolve(
            model=_model(), context=_context()
        )


async def test_saved_slug_selects_one_of_two_keys_for_one_provider(
    fake_http, connection
):
    fake_http(
        connections,
        payload=[
            _provider_key("OpenAI", "openai", "sk-first", slug="openai-aaaaaaaaaaaa"),
            _provider_key(
                "OpenAI 2", "openai", "sk-second", slug="openai-2-bbbbbbbbbbbb"
            ),
        ],
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("openai-2-bbbbbbbbbbbb"), context=_context()
    )

    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-second"}


async def test_a_slugged_record_still_resolves_provider_only_when_unique(
    fake_http, connection
):
    fake_http(
        connections,
        payload=[
            _provider_key("OpenAI", "openai", "sk-one", slug="openai-aaaaaaaaaaaa")
        ],
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(slug=None), context=_context()
    )

    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-one"}


async def test_legacy_record_without_a_slug_stays_addressable_by_provider(
    fake_http, connection
):
    fake_http(connections, payload=[_provider_key("My key", "openai", "sk-legacy")])

    # Both the provider-only default and the provider-as-slug form existing agent
    # configurations committed still reach the record.
    for model in (_model(slug=None), _model("openai")):
        resolved = await VaultConnectionResolver(connection).resolve(
            model=model, context=_context()
        )
        assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-legacy"}


def test_saved_models_and_harnesses_are_carried_on_the_candidate():
    catalog = connections._catalog(
        [
            _provider_key(
                "OpenAI",
                "openai",
                "sk-one",
                slug="openai-aaaaaaaaaaaa",
                models=["gpt-5.6-luna", "gpt-5.6-sol"],
                harnesses=["pi_core", "codex"],
            ),
            _provider_key("Legacy", "anthropic", "sk-ant"),
        ]
    )

    saved, legacy = catalog
    assert saved.slug == "openai-aaaaaaaaaaaa"
    assert saved.models == ["gpt-5.6-luna", "gpt-5.6-sol"]
    assert saved.harnesses == ["pi_core", "codex"]
    # A record that saved nothing must stay distinguishable from one that saved an empty
    # list: the first uses Agenta's defaults, the second offers no models at all.
    assert legacy.slug == "anthropic"
    assert legacy.models is None
    assert legacy.harnesses is None
    assert (
        connections._catalog([_provider_key("None", "groq", "k", models=[])])[0].models
        == []
    )


async def test_saved_models_do_not_filter_resolution_yet(fake_http, connection):
    fake_http(
        connections,
        payload=[
            _provider_key(
                "OpenAI",
                "openai",
                "sk-one",
                slug="openai-aaaaaaaaaaaa",
                models=["gpt-5.6-luna"],
                harnesses=["codex"],
            )
        ],
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("openai-aaaaaaaaaaaa"), context=_context()
    )

    # The request asks for a model outside the saved list on a harness outside the saved
    # set; enforcement belongs to a later slice, so resolution must not start filtering here.
    assert resolved.model == "gpt-5.5"
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-one"}


async def test_custom_connection_resolves_by_its_stored_slug(fake_http, connection):
    # The slug is identity, so renaming the connection must not move it: the record answers to
    # its stored slug even though the display name now says something else.
    endpoint = "https://93.184.216.34/v1"
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "Renamed gateway",
                "custom",
                key="sk-gw",
                url=endpoint,
                models=["qwen2.5-coder:7b"],
                slug="my-gateway-abcdef123456",
            )
        ],
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef(
            model="qwen2.5-coder:7b",
            connection={"mode": "agenta", "slug": "my-gateway-abcdef123456"},
        ),
        context=_context(),
    )

    assert resolved.deployment == "custom"
    assert resolved.endpoint.base_url == endpoint
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-gw"}


async def test_legacy_custom_connection_without_a_slug_resolves_by_name(
    fake_http, connection
):
    endpoint = "https://93.184.216.34/v1"
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-gateway",
                "custom",
                key="sk-legacy",
                url=endpoint,
                models=["qwen2.5-coder:7b"],
            )
        ],
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef(
            model="qwen2.5-coder:7b",
            connection={"mode": "agenta", "slug": "my-gateway"},
        ),
        context=_context(),
    )

    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-legacy"}


def test_a_slugged_custom_record_keeps_its_model_key_namespace():
    # Stored model keys are namespaced by the display name, so a committed model selector must
    # keep matching after the record gained a slug.
    candidate = connections._catalog(
        [
            _custom_provider(
                "my-bedrock",
                "bedrock",
                models=["anthropic.claude-3"],
                slug="my-bedrock-abcdef123456",
            )
        ]
    )[0]

    assert candidate.slug == "my-bedrock-abcdef123456"
    assert candidate.model_keys == {"my-bedrock/bedrock/anthropic.claude-3"}
