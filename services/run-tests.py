#!/usr/bin/env python3
from __future__ import annotations

from typing import Optional
import os
import subprocess
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
    help="Path to a .env.* file with AGENTA_API_URL and AGENTA_AUTH_KEY",
)
@click.option(
    "--api-url",
    type=str,
    help="API URL for Agenta",
    envvar="AGENTA_API_URL",
)
@click.option(
    "--auth-key",
    type=str,
    help="Access token for Agenta",
    envvar="AGENTA_AUTH_KEY",
)
@click.option(
    "--timeout",
    type=float,
    default=10.0,
    show_default=True,
    help="HTTP timeout for smoke checks (seconds)",
)
@click.argument(
    "pytest_args",
    nargs=-1,
    type=click.UNPROCESSED,
)
def run_tests(
    env_file: Optional[str] = None,
    api_url: Optional[str] = None,
    auth_key: Optional[str] = None,
    timeout: float = 10.0,
    pytest_args: Optional[tuple] = None,
) -> None:
    """
    Run services smoke checks then pytest acceptance tests.

    Additional args after '--' are passed directly to pytest.
    Examples:
        python run-tests.py --env-file ../.env.dev
        python run-tests.py --env-file ../.env.dev -- -n 4 -v
        python run-tests.py --env-file ../.env.dev -- oss/tests/pytest/acceptance/
    """
    if env_file:
        load_dotenv(env_file)
        click.echo(f"Loaded environment variables from {env_file}")
        if not api_url:
            api_url = os.getenv("AGENTA_API_URL")
        if not auth_key:
            auth_key = os.getenv("AGENTA_AUTH_KEY")

    if api_url:
        os.environ["AGENTA_API_URL"] = api_url
        click.echo(f"AGENTA_API_URL={api_url}")
    if auth_key:
        os.environ["AGENTA_AUTH_KEY"] = auth_key
        L = len(auth_key)
        click.echo(f"AGENTA_AUTH_KEY={auth_key[:2]}{'.' * (L - 4)}{auth_key[-2:]}")

    # Derive services URL for smoke checks
    _api_url = os.getenv("AGENTA_API_URL", "http://localhost/api")
    services_url = derive_services_url(_api_url).rstrip("/")
    click.echo(f"AGENTA_SERVICES_URL={services_url}")

    # Smoke checks
    for path in ["/chat/health", "/completion/health"]:
        url = f"{services_url}{path}"
        check_health(url, timeout)
        click.echo(f"OK {url}")

    click.echo("Services smoke checks passed")

    # Build pytest command
    extra_paths = [a for a in (pytest_args or []) if not a.startswith("-")]
    test_dirs = extra_paths if extra_paths else ["oss/tests/pytest"]

    cmd = ["pytest"] + test_dirs

    flags_only = [a for a in (pytest_args or []) if a.startswith("-")]
    cmd += flags_only

    services_dir = os.path.dirname(os.path.abspath(__file__))
    click.echo(f"\nExecuting: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=services_dir, check=True)


if __name__ == "__main__":
    run_tests()
