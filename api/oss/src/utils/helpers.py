from typing import List, Dict
from uuid import UUID
import sys
import unicodedata
import re

import click

from oss.src.utils.env import env


def get_metrics_keys_from_schema(schema=None, path=()) -> List[Dict[str, str]]:
    metrics = []

    if not isinstance(schema, dict) or "type" not in schema:
        return metrics

    metric_type = None

    t = schema["type"]

    if t == "object":
        if "properties" in schema:
            for key, prop in schema["properties"].items():
                metrics.extend(get_metrics_keys_from_schema(prop, path + (key,)))
        else:
            metric_type = "json"

    elif t == "array" and "items" in schema:
        if schema["items"].get("type") == "string" and "enum" in schema["items"]:
            metric_type = "categorical/multiple"

    elif t == "boolean":
        metric_type = "binary"

    elif t == "string":
        metric_type = "categorical/single" if "enum" in schema else "string"

    elif t == "number":
        metric_type = "numeric/continuous"

    elif t == "integer":
        metric_type = "numeric/discrete"

    if metric_type:
        metrics.append({"path": ".".join(path), "type": metric_type})

    return metrics


def get_slug_from_name_and_id(
    name: str,
    id: UUID,  # pylint: disable=redefined-builtin
) -> str:
    # Normalize Unicode (e.g., é → e)
    name = unicodedata.normalize("NFKD", name)
    # Remove non-ASCII characters
    name = name.encode("ascii", "ignore").decode("ascii")
    # Lowercase and remove non-word characters except hyphens and spaces
    name = re.sub(r"[^\w\s-]", "", name.lower())
    # Replace any sequence of hyphens or whitespace with a single hyphen
    name = re.sub(r"[-\s]+", "-", name)
    # Trim leading/trailing hyphens
    name = name.strip("-")
    # Last 12 characters of the ID
    slug = f"{name}-{id.hex[-12:]}"

    return slug.lower()


def parse_url(url: str) -> str:
    """
    Parses and potentially rewrites a URL based on the environment and Docker network mode.

    Args:
        url (str): The original URL to parse and potentially rewrite.

    Returns:
        str: The parsed or rewritten URL suitable for the current environment and Docker network mode.
    """

    url = url.rstrip("/")

    if "localhost" not in url and "0.0.0.0" not in url:
        return url

    docker_network_mode = env.docker.network_mode

    if (
        not docker_network_mode
        or (docker_network_mode and docker_network_mode.lower()) == "bridge"
    ):
        return url.replace(
            "localhost",
            "host.docker.internal",
        ).replace(
            "0.0.0.0",
            "host.docker.internal",
        )

    if docker_network_mode == "host":
        return url

    return url.replace(
        "localhost",
        "host.docker.internal",
    ).replace(
        "0.0.0.0",
        "host.docker.internal",
    )


def warn_deprecated_env_vars():
    deprecated_env_map = {
        "AGENTA_HOST": None,
        "POSTGRES_DB": None,
        "AGENTA_PORT": "TRAEFIK_PORT",
        "BARE_DOMAIN_NAME": "TRAEFIK_DOMAIN",
        "DOMAIN_NAME": "AGENTA_API_URL",
        "WEBSITE_DOMAIN_NAME": "AGENTA_WEB_URL",
        "SERVICE_URL_TEMPLATE": "AGENTA_SERVICES_URL",
        "POSTGRES_URI": "POSTGRES_URI_CORE, POSTGRES_URI_TRACING, and POSTGRES_URI_SUPERTOKENS",
        "ALEMBIC_CFG_PATH": "ALEMBIC_CFG_PATH_CORE and ALEMBIC_CFG_PATH_TRACING",
    }

    messages = []

    for old_var, new_var in deprecated_env_map.items():
        if getattr(env, old_var, None) is not None:
            if new_var is not None:
                messages.append(
                    f"Environment variable '{old_var}' is deprecated and will be removed in the next release. "
                    f"Please use '{new_var}' instead."
                    if new_var
                    else ""
                )

            else:
                messages.extend(
                    [
                        f"Environment variable '{old_var}' is deprecated and will be removed in the next release. "
                        f"Please consider removing it."
                    ]
                )

    if messages:
        click.echo(
            click.style(
                "\n———————————————————— [DEPRECATION WARNING] ————————————————————  \n\n Detected deprecated environment variables:\n",
                fg="yellow",
            )
        )
        click.echo(
            click.style(
                "\n".join(f"  - {msg}" for msg in messages),
                fg="yellow",
            )
        )
        click.echo(
            click.style(
                "\n\nPlease refer to the docs for migration details:\n"
                "  → https://agenta.ai/docs/misc/environment-variables\n\n"
                "Some of these values have been migrated automatically, but you must manually remove the old ones.",
                fg="yellow",
            )
        )
        click.echo(
            click.style(
                "\n———————————————————— [END DEPRECATION WARNING] ————————————————————\n",
                fg="yellow",
            )
        )


def validate_required_env_vars():
    """
    Ensure required configuration values are present.

    Uses the resolved values from the structured env object (not raw os.getenv),
    so defaults/fallbacks defined in config classes are honored.
    """
    required = {
        "AGENTA_API_URL": env.agenta.api_url,
        "AGENTA_AUTH_KEY": env.agenta.auth_key,
        "AGENTA_CRYPT_KEY": env.agenta.crypt_key,
        "SUPERTOKENS_CONNECTION_URI": env.supertokens.uri_core,
        "POSTGRES_URI_CORE": env.postgres.uri_core,
        "POSTGRES_URI_TRACING": env.postgres.uri_tracing,
        "POSTGRES_URI_SUPERTOKENS": env.postgres.uri_supertokens,
        "ALEMBIC_CFG_PATH_CORE": env.alembic.cfg_path_core,
        "ALEMBIC_CFG_PATH_TRACING": env.alembic.cfg_path_tracing,
    }

    missing = [
        name
        for name, value in required.items()
        if value is None or (isinstance(value, str) and value.strip() == "")
    ]

    if missing:
        click.echo(
            click.style(
                "\n———————————————————— [MISSING VARIABLES] ————————————————————  \n\n Detected missing environment variables:\n",
                fg="yellow",
            )
        )
        click.echo(
            click.style(
                "\n".join(f"  - {var}" for var in missing),
                fg="yellow",
            )
        )
        click.echo(
            click.style(
                "\n Shutting down due to missing configuration.",
                fg="yellow",
            )
        )
        click.echo(
            click.style(
                "\n———————————————————— [END MISSING VARIABLES] ————————————————————\n",
                fg="yellow",
            )
        )
        sys.exit(1)
