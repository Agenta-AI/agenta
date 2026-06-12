import subprocess
from pathlib import Path


def find_repo_root(start: Path) -> Path:
    for parent in [start, *start.parents]:
        if (parent / "web" / "entrypoint.sh").exists():
            return parent
    raise RuntimeError("Could not find repository root")


REPO_ROOT = find_repo_root(Path(__file__).resolve())


def _run_entrypoint(tmp_path, repo_root, env):
    result = subprocess.run(
        ["/bin/sh", str(repo_root / "web" / "entrypoint.sh"), "true"],
        cwd=tmp_path,
        env={
            "PATH": "/usr/bin:/bin",
            "ENTRYPOINT_DIR": ".",
            "AGENTA_LICENSE": "oss",
            **env,
        },
        check=True,
        capture_output=True,
        text=True,
    )
    env_js = tmp_path / "oss" / "public" / "__env.js"
    assert env_js.exists(), result.stderr
    return env_js.read_text()


def test_entrypoint_enables_otp_for_smtp_only_config(tmp_path):
    env_js = _run_entrypoint(
        tmp_path,
        REPO_ROOT,
        {
            "SMTP_HOST": "host.docker.internal",
            "SMTP_PORT": "1025",
            "SMTP_FROM_EMAIL": "dev@example.com",
        },
    )

    assert 'NEXT_PUBLIC_AGENTA_AUTHN_EMAIL: "otp"' in env_js
    assert 'NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED: "true"' in env_js


def test_entrypoint_preserves_sendgrid_only_otp_config(tmp_path):
    env_js = _run_entrypoint(
        tmp_path,
        REPO_ROOT,
        {
            "SENDGRID_API_KEY": "sg-key",
            "SENDGRID_FROM_EMAIL": "sendgrid@example.com",
        },
    )

    assert 'NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED: "true"' in env_js
    assert 'NEXT_PUBLIC_AGENTA_AUTHN_EMAIL: "otp"' in env_js
    assert 'NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED: "true"' in env_js


def test_entrypoint_does_not_enable_otp_for_incomplete_smtp(tmp_path):
    env_js = _run_entrypoint(
        tmp_path,
        REPO_ROOT,
        {
            "SMTP_HOST": "host.docker.internal",
            "SMTP_FROM_EMAIL": "dev@example.com",
        },
    )

    assert 'NEXT_PUBLIC_AGENTA_AUTHN_EMAIL: "password"' in env_js
    assert 'NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED: "true"' in env_js
