from typing import Optional, Dict, Any, List

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.net import assert_endpoint_url_allowed
from agenta.sdk.utils.providers import normalize_provider_kind
from agenta.sdk.contexts.routing import RoutingContext
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.utils.assets import (
    litellm_model_id,
    model_to_provider_mapping as _standard_providers,
)
from agenta.sdk.engines.running.errors import (
    ConnectionModelMismatchV0Error,
    UnknownConnectionV0Error,
)

from agenta.sdk.middlewares.running.vault import get_secrets

import agenta as ag

log = get_module_logger(__name__)


def _safe_api_base(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        assert_endpoint_url_allowed(url)
    except ValueError:
        log.warning("custom_provider url blocked by SSRF guard, dropping api_base")
        return None
    return url


class SecretsManager:
    @staticmethod
    def _normalize_provider_kind(provider_kind: str) -> str:
        return normalize_provider_kind(provider_kind)

    @staticmethod
    def get_from_route(scope: str = "all") -> Optional[List[Dict[str, Any]]]:
        context = RoutingContext.get()

        if scope == "local":
            secrets = context.local_secrets
        elif scope == "vault":
            secrets = context.vault_secrets
        else:
            secrets = context.secrets

        if not secrets:
            return []

        return secrets

    @staticmethod
    def _stripped(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _saved_models(data: Dict[str, Any]) -> Optional[List[str]]:
        """The connection's saved model slugs, or ``None`` when it saved no list.

        ``None`` (use Agenta's defaults) and ``[]`` (offer nothing) mean different things, so
        the absent case stays distinguishable from the empty one.
        """
        models = data.get("models")
        if models is None:
            return None
        slugs = [
            SecretsManager._stripped(
                model.get("slug") if isinstance(model, dict) else model
            )
            for model in models
        ]
        return [slug for slug in slugs if slug]

    @staticmethod
    def _parse_standard_secrets(
        secret: Dict[str, Any], standard_secrets: List[Dict[str, Any]]
    ):
        data = secret.get("data", {})
        standard_secrets.append(
            {
                "kind": secret.get("kind", ""),
                # Records created since named connections carry a stable slug and are addressed
                # by it, so a project can hold several keys per provider. Older records (and the
                # env-var locals) have none and stay addressable by their provider family — the
                # same identity rule the agent resolver uses.
                "slug": SecretsManager._stripped(secret.get("slug"))
                or SecretsManager._stripped(data.get("kind")),
                "models": SecretsManager._saved_models(data),
                "data": data,
            }
        )

    @staticmethod
    def _parse_custom_secrets(
        secret: Dict[str, Any],
        custom_secrets: List[Dict[str, Any]],
    ):
        data = secret.get("data", {})
        safe_url = _safe_api_base(data.get("provider", {}).get("url"))
        custom_secrets.append(
            {
                "kind": secret.get("kind", ""),
                # `provider_slug` mirrors `header.name`, which is what a custom connection was
                # addressed by before stable slugs existed.
                "slug": SecretsManager._stripped(secret.get("slug"))
                or SecretsManager._stripped(data.get("provider_slug")),
                "data": {
                    "provider_slug": data.get("provider_slug"),
                    "provider": {
                        "kind": data.get("kind", ""),
                        "extras": (
                            {
                                **data["provider"]["extras"],
                                "api_base": safe_url,
                                "api_version": data["provider"].get("version"),
                            }
                            if all(
                                k in data.get("provider", {}) for k in ["extras", "url"]
                            )
                            and safe_url
                            else data.get("provider", {}).get("extras", {})
                        ),
                    },
                    "models": data.get("model_keys", []),
                },
            }
        )

    @staticmethod
    def _parse_secrets(secrets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        standard_secrets: List[dict] = []
        custom_secrets: List[dict] = []

        for secret in secrets:
            if secret.get("kind") == "provider_key":
                SecretsManager._parse_standard_secrets(
                    secret=secret,
                    standard_secrets=standard_secrets,
                )  # append secret to standard_secrets
            elif secret.get("kind") == "custom_provider":
                SecretsManager._parse_custom_secrets(
                    secret=secret,
                    custom_secrets=custom_secrets,
                )  # append secret to custom_secrets

        secrets = standard_secrets + custom_secrets

        return secrets

    @staticmethod
    def _custom_provider_get_value(
        *, model: str, secrets: list[dict], key: str, from_provider: bool = True
    ):
        for secret in secrets:
            models = secret.get("data", {}).get("models", [])
            if model in models:
                if from_provider:
                    return secret.get("data", {}).get("provider", {}).get(key)
                return secret.get("data", {}).get(key)
        return None

    @staticmethod
    def _custom_providers_get(*, model: str, secrets: list[dict]):
        return SecretsManager._custom_provider_get_value(
            model=model, secrets=secrets, key="kind", from_provider=True
        )

    @staticmethod
    def _custom_provider_slug_get(*, model: str, secrets: list[dict]):
        return SecretsManager._custom_provider_get_value(
            model=model, secrets=secrets, key="provider_slug", from_provider=False
        )

    @staticmethod
    def _get_compatible_model(*, model: str, provider_slug: str):
        """Return the model string used by litellm.

        Args:
            model (str): The complete model string (e.g. `mybedrock/bedrock/model_name`).
                         In the format provider_slug/kind/model_name (See SecretResponseDTO)
            provider_slug (str): The provider slug (e.g. `mybedrock`)

        Returns:
            str: The model string used by litellm
        """
        # First replace provider_slug/custom with openai.
        # The reason is that custom providers are in fact openai compatible providers
        # They need to be passed in litellm as openai/modelname

        modified_model = model

        if "custom" in modified_model:
            modified_model = modified_model.replace(
                f"{provider_slug}/custom/", "openai/"
            )

        if provider_slug:
            modified_model = modified_model.replace(f"{provider_slug}/", "")

        return modified_model

    @staticmethod
    def _litellm_model(*, model: str, family: Optional[str]) -> str:
        """Give a standard provider's model the litellm prefix its family expects.

        A safety net for callers that hand us a bare id — a picker that stores "claude-fable-5"
        against an Anthropic connection means the same model as "anthropic/claude-fable-5", but
        only the latter tells litellm which API to call. Idempotent, so an id that already
        carries its prefix passes through untouched.

        Catalog first: a model the prompt catalog knows uses its own family, so a record whose
        kind is spelled differently ("mistralai") cannot mis-prefix it. `family` is the fallback
        for ids the catalog has never heard of, which is the case this exists for.

        Only ever called for `provider_key` records. A custom connection's model string has
        already been rewritten by `_get_compatible_model` into litellm's `openai/<model>` form,
        and prefixing that again would corrupt it — see both call sites.
        """
        resolved = _standard_providers.get(model) or family
        if not resolved:
            return model

        return litellm_model_id(
            model, SecretsManager._normalize_provider_kind(resolved)
        )

    @staticmethod
    def _claims_model(
        *, secret: Dict[str, Any], model: str, family: Optional[str]
    ) -> bool:
        """Does this record's saved model list name `model`?

        The two sides are spelled differently by design: a saved list stores the provider's own
        spelling ("claude-sonnet-5") so it reads the same in every harness, while a config
        stores the litellm one ("anthropic/claude-sonnet-5"). Compared raw, an explicit claim on
        a model never matches for any family but OpenAI, and the tiebreak below quietly falls
        through to the first record of the family — a different connection's key, with no error.

        `family` is None for a model that resolved through a custom connection, which keeps the
        exact comparison it has always had.
        """
        saved = secret.get("models") or []

        if model in saved:
            return True

        if not family:
            return False

        target = SecretsManager._litellm_model(model=model, family=family)

        return any(
            SecretsManager._litellm_model(model=slug, family=family) == target
            for slug in saved
        )

    # ------------------------------------------------------------------
    # Resolution
    #
    # One implementation behind both context entry points below. The order is:
    #
    #   1. An explicit connection slug selects that vault record outright, standard or custom.
    #      An unknown slug raises rather than falling back — see `UnknownConnectionV0Error`.
    #   2. With no slug, the model maps to a provider family (the prompt catalog first, then a
    #      custom connection's own model list) and, among that family's standard records, the
    #      one whose saved model list names the requested model wins; otherwise the FIRST
    #      record of the family — first-wins, which is the pre-connections behavior and is what
    #      the picker relies on when it leaves a lone-connection family's slug unwritten.
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_provider_settings(
        *,
        secrets: Optional[List[Dict[str, Any]]],
        model: str,
        connection: Optional[str],
    ) -> Optional[Dict]:
        if not secrets:
            return None

        parsed = SecretsManager._parse_secrets(secrets=secrets)

        if connection:
            return SecretsManager._settings_by_connection(
                secrets=parsed, model=model, connection=connection
            )

        return SecretsManager._settings_by_family(secrets=parsed, model=model)

    @staticmethod
    def _settings_by_connection(
        *, secrets: List[Dict[str, Any]], model: str, connection: str
    ) -> Optional[Dict]:
        record = next(
            (secret for secret in secrets if secret.get("slug") == connection), None
        )
        if record is None:
            raise UnknownConnectionV0Error(
                connection,
                [secret["slug"] for secret in secrets if secret.get("slug")],
            )

        data = record.get("data", {})
        provider_info = data.get("provider", {})

        if record.get("kind") == "provider_key":
            SecretsManager._assert_model_matches_family(
                record=record, model=model, connection=connection
            )
            if "key" not in provider_info:
                return None
            return dict(
                model=SecretsManager._litellm_model(
                    model=model, family=data.get("kind", "")
                ),
                api_key=provider_info["key"],
            )

        # A custom connection's model string encodes its namespace
        # (`provider_slug/kind/model`), so the slug and the model have to agree or the litellm
        # rewrite below produces nonsense. They disagree after the connection is renamed, which
        # rewrites `provider_slug` and therefore every model key. Fail the same way the family
        # path already does — a loud InvalidSecrets in the caller — rather than calling out with
        # a mangled model name.
        if model not in (data.get("models") or []):
            return None

        provider_settings = dict(
            model=SecretsManager._get_compatible_model(
                model=model, provider_slug=data.get("provider_slug") or ""
            )
        )
        extras = provider_info.get("extras", {})
        if extras:
            provider_settings.update(extras)

        if len(provider_settings.keys()) <= 1:
            return None

        return provider_settings

    @staticmethod
    def _assert_model_matches_family(
        *, record: Dict[str, Any], model: str, connection: str
    ) -> None:
        """A slug picks the credential, but the model still has to belong to that provider.

        An Anthropic connection asked for `gpt-4o-mini` would hand litellm an OpenAI model with
        an Anthropic key, and come back as an opaque downstream 401. A model the catalog does
        not know passes through untouched — manual and freshly released ids must keep working.
        """
        model_family = _standard_providers.get(model)
        record_family = record.get("data", {}).get("kind", "")
        if not model_family or not record_family:
            return

        if SecretsManager._normalize_provider_kind(
            model_family
        ) != SecretsManager._normalize_provider_kind(record_family):
            raise ConnectionModelMismatchV0Error(
                slug=connection,
                connection_family=record_family,
                model=model,
                model_family=model_family,
            )

    @staticmethod
    def _settings_by_family(
        *, secrets: List[Dict[str, Any]], model: str
    ) -> Optional[Dict]:
        request_provider_model = model

        # STEP 1: check model exists in supported standard models
        standard_family = _standard_providers.get(request_provider_model)
        provider = standard_family
        if not provider:
            # check and get provider kind if model exists in custom provider models
            provider = SecretsManager._custom_providers_get(
                model=request_provider_model,
                secrets=secrets,
            )

        # STEP 1b: return None in the case provider is None
        if not provider:
            return None

        # STEP 1c: get litellm compatible model
        request_provider_slug = (
            SecretsManager._custom_provider_slug_get(
                model=request_provider_model, secrets=secrets
            )
            or ""
        )
        compatible_provider_model = SecretsManager._get_compatible_model(
            model=request_provider_model, provider_slug=request_provider_slug
        )

        # STEP 2: initialize provider settings and simplify provider name.
        # A model that resolved through the catalog is a standard provider's, so it goes to
        # litellm with its family prefix. A model that resolved through a custom connection is
        # exempt: `standard_family` is None for it, and `_get_compatible_model` above has
        # already put its model string in the form litellm wants.
        provider_settings = dict(
            model=SecretsManager._litellm_model(
                model=compatible_provider_model, family=standard_family
            )
            if standard_family
            else compatible_provider_model
        )
        request_provider_kind = SecretsManager._normalize_provider_kind(provider)

        # STEP 3a: standard credentials (openai/anthropic/gemini, ...). A connection that saved
        # the requested model wins over a bare family match; ties fall back to the first record.
        family_records = [
            secret
            for secret in secrets
            if secret.get("kind") == "provider_key"
            and SecretsManager._normalize_provider_kind(
                secret.get("data", {}).get("kind", "")
            )
            == request_provider_kind
        ]
        chosen = next(
            (
                secret
                for secret in family_records
                if SecretsManager._claims_model(
                    secret=secret,
                    model=request_provider_model,
                    family=standard_family,
                )
            ),
            next(
                # No saved list means "follow Agenta's defaults", so the record still offers this
                # model. A record that saved a list without it was narrowed away from the model
                # by the user, so it loses to a list-less one even when it comes first.
                (secret for secret in family_records if secret.get("models") is None),
                family_records[0] if family_records else None,
            ),
        )
        if chosen:
            provider_info = chosen.get("data", {}).get("provider", {})
            if "key" in provider_info:
                provider_settings["api_key"] = provider_info["key"]

        # STEP 3b: custom provider credentials (aws bedrock/sagemaker, vertex_ai, ...)
        for secret in secrets:
            if secret.get("kind") != "custom_provider":
                continue

            secret_data = secret.get("data", {})
            provider_info = secret_data.get("provider", {})
            secret_provider_kind = (
                provider_info.get("kind", "").lower().replace(" ", "")
            )
            secret_provider_slug = secret_data.get("provider_slug", "")
            secret_provider_models = secret_data.get("models", "")
            secret_provider_extras = provider_info.get("extras", {})

            if (
                request_provider_kind == secret_provider_kind
                and request_provider_slug == secret_provider_slug
                and request_provider_model in secret_provider_models
            ):
                if secret_provider_extras:
                    provider_settings.update(secret_provider_extras)

        if len(provider_settings.keys()) <= 1:
            return None

        return provider_settings

    @staticmethod
    def get_provider_settings(
        model: str, scope: str = "all", connection: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Builds the LLM request with appropriate kwargs based on the custom provider/model

        Args:
            model (str): The name of the model
            connection (Optional[str]): Slug of the saved provider connection to use. When
                omitted, the model resolves through its provider family (legacy behavior).

        Returns:
            Dict: A dictionary containing all parameters needed for litellm.completion
        """

        return SecretsManager._resolve_provider_settings(
            secrets=SecretsManager.get_from_route(scope=scope),
            model=model,
            connection=connection,
        )

    @staticmethod
    async def retrieve_secrets() -> tuple[list, list, list]:
        host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host
        scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
        scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

        return await get_secrets(
            f"{host}/api",
            RunningContext.get().credentials,
            host,
            scope_type,
            scope_id,
        )

    @staticmethod
    async def ensure_secrets_in_workflow():
        ctx = RunningContext.get()

        # First check if secrets are already available in RunningContext
        # (populated by decorators/running.py via workflow.invoke)
        if ctx.secrets:
            return ctx.secrets

        # Then check RoutingContext (populated by old serving.py decorator)
        routing_ctx = RoutingContext.get()
        if routing_ctx.secrets:
            ctx.secrets = routing_ctx.secrets
            ctx.vault_secrets = routing_ctx.vault_secrets
            ctx.local_secrets = routing_ctx.local_secrets

            RunningContext.set(ctx)

            return ctx.secrets

        # Fall back to fetching via retrieve_secrets() for non-HTTP workflow contexts
        secrets, vault_secrets, local_secrets = await SecretsManager.retrieve_secrets()

        ctx.secrets = secrets
        ctx.vault_secrets = vault_secrets
        ctx.local_secrets = local_secrets

        RunningContext.set(ctx)

        return ctx.secrets

    @staticmethod
    def get_provider_settings_from_workflow(
        model: str, scope: str = "all", connection: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Builds the LLM request with appropriate kwargs based on the custom provider/model

        Args:
            model (str): The name of the model
            connection (Optional[str]): Slug of the saved provider connection to use. When
                omitted, the model resolves through its provider family (legacy behavior).

        Returns:
            Dict: A dictionary containing all parameters needed for litellm.completion
        """

        ctx = RunningContext.get()
        if scope == "local":
            secrets = ctx.local_secrets
        elif scope == "vault":
            secrets = ctx.vault_secrets
        else:
            secrets = ctx.secrets

        return SecretsManager._resolve_provider_settings(
            secrets=secrets,
            model=model,
            connection=connection,
        )
