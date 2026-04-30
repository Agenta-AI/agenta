#!/usr/bin/env python3
from typing import Optional
import os
import subprocess
import click

from dotenv import load_dotenv


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOCAL_SDK_DIR = os.path.join(ROOT_DIR, "sdk")


TYPES = {
    "license": ["ee", "oss"],
    "coverage": ["smoke", "full"],
    "lens": ["functional", "performance", "security"],
    "plan": ["hobby", "pro", "business", "enterprise"],
    "role": ["owner", "admin", "developer", "editor", "annotator", "viewer"],
    "path": ["happy", "grumpy"],
    "case": ["typical", "edge"],
    "speed": ["fast", "slow"],
    "cost": ["free", "paid"],
}


def _has_pytest_option(pytest_args: Optional[tuple], option: str) -> bool:
    if not pytest_args:
        return False

    return any(arg == option or arg.startswith(f"{option}=") for arg in pytest_args)


def _resolve_license() -> str:
    return "ee" if os.getenv("AGENTA_LICENSE") == "ee" else "oss"


def _prepend_pythonpath(path: str) -> None:
    current = os.environ.get("PYTHONPATH")
    paths = [path]
    if current:
        paths.append(current)
    os.environ["PYTHONPATH"] = os.pathsep.join(paths)


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
    help="Role [owner|admin|developer|editor|annotator|viewer]",
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
        click.echo(f"Loaded environment variables from {env_file}")
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

    license = _resolve_license()
    click.echo(f"AGENTA_LICENSE={license}")

    if os.path.isdir(LOCAL_SDK_DIR):
        _prepend_pythonpath(LOCAL_SDK_DIR)

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

    # If pytest_args contains test paths, use them instead of test_dirs
    extra_paths = [a for a in (pytest_args or []) if not a.startswith("-")]
    cmd = ["pytest"] + (extra_paths if extra_paths else test_dirs)

    if marker_args:
        marker_expr = " and ".join(marker_args)
        cmd += ["-m", marker_expr]

    results_dir = os.path.join(license, "tests", "results")
    os.makedirs(results_dir, exist_ok=True)

    if not _has_pytest_option(pytest_args, "--junit-xml"):
        cmd.append(f"--junit-xml={results_dir}/junit.xml")
    if not _has_pytest_option(pytest_args, "--html"):
        cmd.append(f"--html={results_dir}/report.html")

    if pytest_args:
        flags_only = [a for a in pytest_args if a.startswith("-")]
        cmd += flags_only

    click.echo(f"Executing: {' '.join(cmd)}")

    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    run_tests()
