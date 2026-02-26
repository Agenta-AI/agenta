#!/usr/bin/env python3
from typing import Optional
import os
import subprocess
import click

from dotenv import load_dotenv


TYPES = {
    "license": ["ee", "oss"],
    "coverage": ["smoke", "full"],
    "lens": ["functional", "performance", "security"],
    "plan": ["hobby", "pro", "business", "enterprise"],
    "role": ["owner", "admin", "editor", "viewer"],
    "path": ["happy", "grumpy"],
    "case": ["typical", "edge"],
    "speed": ["fast", "slow"],
    "cost": ["free", "paid"],
}


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
    "--license",
    default="oss",
    type=click.Choice(TYPES["license"]),
    help="License [oss|ee]",
    show_default=True,
)
@click.option(
    "--coverage",
    type=click.Choice(TYPES["coverage"]),
    help="Coverage [smoke|full] (full = no coverage marker filter)",
    show_default=True,
)
@click.option(
    "--lens",
    type=click.Choice(TYPES["lens"]),
    help="Lens [functional|performance|security]",
    show_default=True,
)
@click.option(
    "--plan",
    type=click.Choice(TYPES["plan"]),
    help="Plan [hobby|pro|business|enterprise]",
)
@click.option(
    "--role",
    type=click.Choice(TYPES["role"]),
    help="Role [owner|admin|editor|viewer]",
)
@click.option(
    "--path",
    type=click.Choice(TYPES["path"]),
    help="Path [happy|grumpy]",
)
@click.option(
    "--case",
    type=click.Choice(TYPES["case"]),
    help="Case [typical|edge]",
)
@click.option(
    "--speed",
    type=click.Choice(TYPES["speed"]),
    help="Speed [fast|slow]",
)
@click.option(
    "--cost",
    type=click.Choice(TYPES["cost"]),
    help="Cost [free|paid]",
)
@click.option(
    "--scope",
    help="Scope [...]",
)
@click.argument(
    "pytest_args",
    nargs=-1,
    type=click.UNPROCESSED,
)
def run_tests(
    license: str,  # pylint: disable=redefined-builtin
    env_file: Optional[str] = None,
    api_url: Optional[str] = None,
    auth_key: Optional[str] = None,
    coverage: Optional[str] = None,
    lens: Optional[str] = None,
    plan: Optional[str] = None,
    role: Optional[str] = None,
    path: Optional[str] = None,
    case: Optional[str] = None,
    speed: Optional[str] = None,
    cost: Optional[str] = None,
    scope: Optional[str] = None,
    pytest_args: Optional[tuple] = None,
):
    """
    Run pytest with dynamic markers and environment configuration.

    Additional args after '--' are passed directly to pytest.
    """
    marker_args = []

    if env_file:
        load_dotenv(env_file)

        # ----------------------------------------------------------------------
        # THIS IS NEEDED BECAUSE OTHERWISE THE SDK THINKS
        # IT IS RUNNING IN THE SAME (BRIDGE) NETWORK AS THE API
        os.environ["DOCKER_NETWORK_MODE"] = "host"
        # ----------------------------------------------------------------------

        click.echo(f"Loaded environment variables from {env_file}")
        _license = os.getenv("AGENTA_LICENSE")
        if _license in TYPES["license"]:
            license = _license  # noqa: F841
        if not api_url:
            api_url = os.getenv("AGENTA_API_URL")
        if not auth_key:
            auth_key = os.getenv("AGENTA_AUTH_KEY")

    # Set API_URL and AUTH_KEY as env vars for tests
    if api_url:
        os.environ["AGENTA_API_URL"] = api_url
        click.echo(f"AGENTA_API_URL={api_url}")
    if auth_key:
        os.environ["AGENTA_AUTH_KEY"] = auth_key
        L = len(auth_key)
        message = f"AGENTA_AUTH_KEY={auth_key[:2]}" + "." * (L - 4) + f"{auth_key[-2:]}"
        click.echo(message)

    # Set optional dimensions
    for name, value in [
        ("COVERAGE", coverage),
        ("LENS", lens),
        ("PLAN", plan),
        ("ROLE", role),
        ("PATH", path),
        ("CASE", case),
        ("SPEED", speed),
        ("COST", cost),
        ("SCOPE", scope),
    ]:
        if value:
            if name == "COVERAGE" and value == "full":
                os.environ.pop("COVERAGE", None)
                click.echo("COVERAGE=full (coverage markers disabled)")
                continue
            os.environ[name] = value
            click.echo(f"{name}={value}")
            marker_args.append(f"{name.lower()}_{value}")

    if license == "ee":
        test_dirs = ["oss/tests/pytest", "ee/tests/pytest"]
    else:
        test_dirs = [f"{license}/tests/pytest"]

    cmd = ["pytest"] + test_dirs

    if marker_args:
        marker_expr = " and ".join(marker_args)
        cmd += ["-m", marker_expr]
    if pytest_args:
        cmd += list(pytest_args)

    click.echo(f"Executing: {' '.join(cmd)}")

    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    run_tests()
