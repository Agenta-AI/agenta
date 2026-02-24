#!/usr/bin/env python3
from __future__ import annotations

from typing import Optional
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import urlopen

import click
from dotenv import load_dotenv


def derive_services_url(api_url: str) -> str:
    parsed = urlsplit(api_url)
    path = parsed.path.rstrip("/")
    if path.endswith("/api"):
        path = path[: -len("/api")]

    services_path = f"{path}/services" if path else "/services"
    return urlunsplit((parsed.scheme, parsed.netloc, services_path, "", ""))


def check_health(url: str, timeout: float) -> None:
    try:
        with urlopen(url, timeout=timeout) as response:
            status = response.getcode()
            if status >= 400:
                raise click.ClickException(f"{url} returned HTTP {status}")
    except HTTPError as exc:
        raise click.ClickException(f"{url} returned HTTP {exc.code}") from exc
    except URLError as exc:
        reason = getattr(exc, "reason", str(exc))
        raise click.ClickException(f"Failed to reach {url}: {reason}") from exc


@click.command()
@click.option(
    "--env-file",
    type=click.Path(exists=True, dir_okay=False),
    help="Path to a .env.* file with AGENTA_SERVICES_URL or AGENTA_API_URL",
)
@click.option(
    "--base-url",
    type=str,
    help="Services base URL",
    envvar=["AGENTA_SERVICES_URL", "SERVICE_BASE_URL"],
)
@click.option(
    "--timeout",
    type=float,
    default=10.0,
    show_default=True,
    help="HTTP timeout in seconds",
)
def run_tests(
    env_file: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: float = 10.0,
) -> None:
    """
    Run services smoke checks.
    """
    if env_file:
        load_dotenv(env_file)
        click.echo(f"Loaded environment variables from {env_file}")
        if not base_url:
            base_url = os.getenv("AGENTA_SERVICES_URL") or os.getenv("SERVICE_BASE_URL")

    if not base_url:
        api_url = os.getenv("AGENTA_API_URL")
        if api_url:
            base_url = derive_services_url(api_url)
            click.echo(f"AGENTA_SERVICES_URL not set; derived from AGENTA_API_URL -> {base_url}")

    if not base_url:
        base_url = "http://localhost/services"

    base_url = base_url.rstrip("/")
    click.echo(f"AGENTA_SERVICES_URL={base_url}")

    checks = ["/chat/health", "/completion/health"]
    for path in checks:
        url = f"{base_url}{path}"
        check_health(url, timeout)
        click.echo(f"OK {url}")

    click.echo("Services smoke checks passed")


if __name__ == "__main__":
    run_tests()
