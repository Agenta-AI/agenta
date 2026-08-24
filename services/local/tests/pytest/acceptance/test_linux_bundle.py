"""Pure bundle assembly gates plus optional smoke of a real built artifact."""

from __future__ import annotations

import dataclasses
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[3]
BUILD_PATH = SERVICE_ROOT / "packaging/linux/build_bundle.py"
VERIFY_PATH = SERVICE_ROOT / "packaging/linux/verify_bundle.py"

LINUX_PYTHON_SHA256 = "aaca2af2ab4d7b68a712660d1334c0cfd5ec13c0312ccd30c29122d8d0342320"
LINUX_NODE_SHA256 = "14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def build_module():
    return _load("agenta_local_build_bundle", BUILD_PATH)


@pytest.fixture(scope="module")
def verify_module():
    return _load("agenta_local_verify_bundle", VERIFY_PATH)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_executable(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)


def _write_stage_checksums(stage: Path) -> None:
    checksum_paths = [
        path
        for path in stage.rglob("*")
        if path.is_file() and path.name != "SHA256SUMS"
    ]
    (stage / "SHA256SUMS").write_text(
        "\n".join(
            f"{_sha256(path)}  {path.relative_to(stage).as_posix()}"
            for path in sorted(checksum_paths)
        )
        + "\n"
    )


def _fake_runner_stage(root: Path) -> Path:
    stage = root / "runner stage"
    for relative in ("runner/src", "runner/dist", "runner/node_modules/tsx"):
        (stage / relative).mkdir(parents=True)
    (stage / "runner/src/server.ts").write_text("export {};\n", encoding="utf-8")
    (stage / "runner/dist/extension.js").write_text("export {};\n", encoding="utf-8")
    (stage / "runner/node_modules/tsx/index.js").write_text("", encoding="utf-8")
    (stage / "runner/package.json").write_text('{"name":"runner","version":"0.0.1"}\n')
    _write_executable(stage / "runtime/node/bin/node", "#!/bin/sh\necho v24.19.0\n")
    _write_executable(stage / "bin/sandbox-agent-wrapper", "#!/bin/sh\nexit 0\n")
    (stage / "licenses").mkdir()
    (stage / "licenses/node-LICENSE").write_text("MIT\n")
    manifest = {"node": {"version": "v24.19.0"}, "runner": {"version": "0.0.1"}}
    (stage / "manifest.json").write_text(json.dumps(manifest))
    _write_stage_checksums(stage)
    return stage


def _fake_python_archive(root: Path, build_module, pin) -> Path:
    tree = root / "python archive"
    python = tree / "python"
    _write_executable(
        python / "bin/python3",
        f"#!/bin/sh\necho 'Python {build_module.PYTHON_VERSION}'\n",
    )
    (python / "licenses").mkdir(parents=True)
    (python / "licenses/LICENSE.txt").write_text("PSF-2.0\n")
    archive = root / pin.python_archive
    with tarfile.open(archive, "w:gz") as handle:
        handle.add(python, arcname="python")
    return archive


def _fake_command_runner(build_module):
    def run(command, *, cwd, env=None):
        if command[0].endswith("python3") and command[1:] == ["--version"]:
            return subprocess.CompletedProcess(
                command, 0, f"Python {build_module.PYTHON_VERSION}\n", ""
            )
        if command[:2] == ["uv", "export"]:
            output = Path(command[command.index("--output-file") + 1])
            output.write_text("httpx==0.28.1 --hash=sha256:abc\n")
        elif command[:2] == ["uv", "build"]:
            output = Path(command[command.index("--out-dir") + 1])
            project = Path(command[-1])
            names = {
                "python": "agenta_client-0.113.0-py3-none-any.whl"
                if "clients" in project.parts
                else "agenta-0.113.0-py3-none-any.whl",
                "local": "agenta_local-0.0.1-py3-none-any.whl",
            }
            name = names["local"] if project.name == "local" else names["python"]
            (output / name).write_bytes(b"wheel")
        elif command[:3] == ["uv", "pip", "install"]:
            target = Path(command[command.index("--target") + 1])
            target.mkdir(parents=True, exist_ok=True)
            if "--requirements" in command:
                packages = [("httpx", "0.28.1")]
            else:
                packages = [
                    ("agenta", "0.113.0"),
                    ("agenta-client", "0.113.0"),
                    ("agenta-local", "0.0.1"),
                ]
            for package, version in packages:
                dist = target / f"{package.replace('-', '_')}-{version}.dist-info"
                dist.mkdir(exist_ok=True)
                (dist / "METADATA").write_text(
                    f"Name: {package}\nVersion: {version}\nLicense-Expression: MIT\n"
                )
                (dist / "LICENSE").write_text("MIT\n")
        return subprocess.CompletedProcess(command, 0, "", "")

    return run


def test_builds_exact_relocatable_layout_with_test_doubles(
    tmp_path, monkeypatch, build_module, verify_module
):
    pin = build_module.PLATFORM_PINS["linux-x64"]
    runner = _fake_runner_stage(tmp_path)
    web = tmp_path / "renderer out"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html>\n")
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "alembic.ini").write_text("[alembic]\n")
    archive = _fake_python_archive(tmp_path, build_module, pin)
    pins = dict(build_module.PLATFORM_PINS)
    pins["linux-x64"] = dataclasses.replace(pin, python_sha256=_sha256(archive))
    output = tmp_path / "dist" / "agenta local linux x64"
    config = build_module.BuildConfig(
        platform="linux-x64",
        output=output,
        runner_stage=runner,
        web_output=web,
        migrations=migrations,
        python_archive=str(archive),
    )

    build_module.build_bundle(
        config,
        command_runner=_fake_command_runner(build_module),
        pins=pins,
    )

    verify_module.validate_layout(output)
    verify_module.validate_checksums(output)
    verify_module.validate_self_contained(output)
    assert (output / "app/web/index.html").is_file()
    assert (output / "app/migrations/alembic.ini").is_file()
    assert not list(output.rglob("*.pth"))
    assert not list(output.rglob("pyvenv.cfg"))
    assert not output.stat().st_mode & stat.S_IWUSR
    wrapper = (output / "bin/agenta-local").read_text()
    assert wrapper.startswith("#!/bin/sh\n")
    assert 'PYTHONPATH="$ROOT/app/python/site-packages"' in wrapper
    assert "agenta_local.entrypoints.launcher" in wrapper
    assert str(tmp_path) not in wrapper
    requirements = output / "licenses/python-requirements.txt"
    assert requirements.is_file()
    assert "agenta==" not in requirements.read_text()
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["target_platform"] == "linux-x64"
    assert manifest["target_arch"] == "x86_64"
    assert manifest["min_libc"] == "glibc >= 2.28"
    assert manifest["python"]["hash_verified_against_upstream"] is True
    assert manifest["python"]["sha256"] == _sha256(archive)


def test_verifier_names_corrupt_component(tmp_path, verify_module):
    bundle = tmp_path / "broken"
    bundle.mkdir()
    with pytest.raises(
        verify_module.VerificationError, match="launcher wrapper is missing"
    ):
        verify_module.validate_layout(bundle)


def test_pins_table_covers_all_supported_platforms(build_module):
    assert build_module.SUPPORTED_PLATFORMS == (
        "linux-x64",
        "darwin-arm64",
        "darwin-x64",
    )
    for platform_id in build_module.SUPPORTED_PLATFORMS:
        pin = build_module.PLATFORM_PINS[platform_id]
        extension = "tar.xz" if platform_id.startswith("linux") else "tar.gz"
        assert pin.node_version == "v24.19.0"
        assert pin.node_archive == f"node-v24.19.0-{platform_id}.{extension}"
        assert (
            pin.node_url
            == f"https://nodejs.org/dist/v24.19.0/node-v24.19.0-{platform_id}.{extension}"
        )
        assert pin.python_archive == (
            f"cpython-3.13.15+20260814-{pin.triple}-install_only_stripped.tar.gz"
        )
        assert pin.python_url == (
            "https://github.com/astral-sh/python-build-standalone/releases/"
            f"download/20260814/{pin.python_archive.replace('+', '%2B')}"
        )
        assert pin.min_libc
        os_name, arch = platform_id.split("-", 1)
        assert build_module.native_component_names(platform_id) == (
            f"@sandbox-agent/cli-{platform_id}",
            f"@esbuild/{os_name}-{arch}",
        )
    linux = build_module.PLATFORM_PINS["linux-x64"]
    assert linux.triple == "x86_64-unknown-linux-gnu"
    assert linux.python_sha256 == LINUX_PYTHON_SHA256
    assert linux.node_sha256 == LINUX_NODE_SHA256
    for platform_id in ("darwin-arm64", "darwin-x64"):
        pin = build_module.PLATFORM_PINS[platform_id]
        # No trusted digest was confirmable from the Linux build host.
        assert pin.python_sha256 is None
        assert pin.node_sha256 is None


def test_platform_detection_env_and_explicit_override(build_module, monkeypatch):
    detection_cases = {
        ("Linux", "x86_64"): "linux-x64",
        ("Darwin", "arm64"): "darwin-arm64",
        ("Darwin", "x86_64"): "darwin-x64",
    }
    for (system, machine), expected in detection_cases.items():
        monkeypatch.setattr(build_module.platform, "system", lambda s=system: s)
        monkeypatch.setattr(build_module.platform, "machine", lambda m=machine: m)
        assert build_module.detect_host_platform() == expected
        assert build_module.resolve_target_platform(None, None) == expected

    monkeypatch.setattr(build_module.platform, "system", lambda: "Linux")
    monkeypatch.setattr(build_module.platform, "machine", lambda: "x86_64")
    # Explicit --platform wins over AGENTA_LOCAL_BUNDLE_PLATFORM wins over host.
    monkeypatch.setenv("AGENTA_LOCAL_BUNDLE_PLATFORM", "darwin-arm64")
    assert (
        build_module.resolve_target_platform(
            None, os.environ["AGENTA_LOCAL_BUNDLE_PLATFORM"]
        )
        == "darwin-arm64"
    )
    assert (
        build_module.resolve_target_platform("darwin-x64", "darwin-arm64")
        == "darwin-x64"
    )
    with pytest.raises(build_module.BuildError, match="unsupported platform"):
        build_module.resolve_target_platform("win32-x64", None)
    monkeypatch.setattr(build_module.platform, "system", lambda: "SunOS")
    with pytest.raises(build_module.BuildError, match="unsupported build host"):
        build_module.resolve_target_platform(None, None)


def _stage_with_native_markers(root: Path, platform_id: str) -> Path:
    stage = _fake_runner_stage(root)
    pnpm = stage / "runner/node_modules/.pnpm"
    pnpm.mkdir(parents=True)
    (pnpm / f"@esbuild+{platform_id}@0.28.1").mkdir()
    (pnpm / f"@sandbox-agent+cli-{platform_id}@0.4.2").mkdir()
    return stage


def test_rejects_runner_stage_installed_for_wrong_platform(tmp_path, build_module):
    stage = _stage_with_native_markers(tmp_path, "linux-x64")
    darwin_pin = build_module.PLATFORM_PINS["darwin-arm64"]

    with pytest.raises(build_module.BuildError) as excinfo:
        build_module.validate_runner_stage(stage, darwin_pin)

    message = str(excinfo.value)
    assert "@esbuild/linux-x64" in message
    assert "@sandbox-agent/cli-linux-x64" in message
    assert "darwin-arm64" in message
    # The same stage is accepted when the target matches its native packages.
    linux_pin = build_module.PLATFORM_PINS["linux-x64"]
    assert build_module.validate_runner_stage(stage, linux_pin)


def test_rejects_runner_stage_manifest_arch_mismatch(tmp_path, build_module):
    stage = _fake_runner_stage(tmp_path)
    manifest_path = stage / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["node"]["arch"] = "linux-x64"
    manifest_path.write_text(json.dumps(manifest))
    _write_stage_checksums(stage)

    with pytest.raises(build_module.BuildError, match="linux-x64.*darwin-x64"):
        build_module.validate_runner_stage(
            stage, build_module.PLATFORM_PINS["darwin-x64"]
        )


def _build_fake_bundle(tmp_path, build_module, platform_id: str) -> Path:
    pin = build_module.PLATFORM_PINS[platform_id]
    runner = _fake_runner_stage(tmp_path)
    web = tmp_path / "web out"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html>\n")
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "alembic.ini").write_text("[alembic]\n")
    archive = _fake_python_archive(tmp_path, build_module, pin)
    config = build_module.BuildConfig(
        platform=platform_id,
        output=tmp_path / "dist" / f"agenta-local-{platform_id}",
        runner_stage=runner,
        web_output=web,
        migrations=migrations,
        python_archive=str(archive),
    )
    build_module.build_bundle(config, command_runner=_fake_command_runner(build_module))
    return config.output


def test_darwin_bundle_records_computed_unverified_hashes(
    tmp_path, verify_module, build_module
):
    output = _build_fake_bundle(tmp_path, build_module, "darwin-arm64")

    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["target_platform"] == "darwin-arm64"
    assert manifest["target_arch"] == "aarch64"
    assert manifest["min_libc"] == "macOS >= 11"
    assert manifest["requirements"]["overall_libc"] == "macOS >= 11"
    assert manifest["python"]["libc"] is None
    assert "%2B" in manifest["python"]["url"]
    assert "aarch64-apple-darwin" in manifest["python"]["url"]
    # No embedded darwin digest existed: record the computed hash as unverified.
    archive_digest = hashlib.sha256(
        (
            tmp_path / build_module.PLATFORM_PINS["darwin-arm64"].python_archive
        ).read_bytes()
    ).hexdigest()
    assert manifest["python"]["sha256"] == archive_digest
    assert manifest["python"]["hash_verified_against_upstream"] is False
    verify_module.validate_layout(output)
    verify_module.validate_checksums(output)


@pytest.mark.skipif(sys.platform != "linux", reason="needs a Linux host")
def test_cross_host_verify_runs_structural_gates_only(
    tmp_path, capsys, build_module, verify_module
):
    output = _build_fake_bundle(tmp_path, build_module, "darwin-arm64")

    verified = verify_module.verify_bundle(output)

    assert verified == output
    captured = capsys.readouterr().out
    assert "structural gates only" in captured
    assert "darwin-arm64" in captured


def test_network_trace_classifier_splits_loopback_from_external(
    tmp_path, verify_module
):
    trace = tmp_path / "network.strace"
    trace.write_text(
        "12345 connect(4<socket:[1]>, {sa_family=AF_INET, sin_port=htons(443), "
        'sin_addr=inet_addr("93.184.216.34")}, 16) = 0\n'
        "12345 connect(5<socket:[2]>, {sa_family=AF_INET, sin_port=htons(53), "
        'sin_addr=inet_addr("127.0.0.53")}, 16) = 0\n'
        "12345 connect(6<socket:[3]>, {sa_family=AF_INET6, sin6_port=htons(443), "
        'sin6_addr=inet_pton(AF_INET6, "::1")}, 28) = 0\n'
        "12345 getsockname(4<socket:[1]>, {sa_family=AF_INET, "
        'sin_port=htons(443), sin_addr=inet_addr("192.168.1.10")}, 16) = 0\n'
    )

    loopback, external = verify_module.classify_network_trace(trace)

    assert loopback == ["127.0.0.53", "::1"]
    assert external == ["93.184.216.34"]


def test_real_bundle_smoke_when_requested(verify_module):
    configured = os.environ.get("AGENTA_LOCAL_BUNDLE_DIR")
    if not configured:
        pytest.skip("AGENTA_LOCAL_BUNDLE_DIR is not set")
    bundle = Path(configured)
    expected_platform = os.environ.get("AGENTA_LOCAL_BUNDLE_PLATFORM")
    if expected_platform:
        manifest = json.loads((bundle / "manifest.json").read_text())
        assert manifest["target_platform"] == expected_platform
    verify_module.verify_bundle(bundle, relocate=True, launch=True)
