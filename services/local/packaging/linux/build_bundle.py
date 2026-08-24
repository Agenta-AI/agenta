"""Build the relocatable Agenta Local directory bundle.

Run from services/local:
    uv run --no-sync python packaging/linux/build_bundle.py [--platform <id>]

Targets: linux-x64, darwin-arm64, darwin-x64. The platform defaults to the build
host and can be overridden with ``--platform`` or ``AGENTA_LOCAL_BUNDLE_PLATFORM``.
Bundles must be built ON the target OS: the runner tree carries OS-specific
native packages that cannot be cross-installed reliably (see BUILDING.md).

The builder consumes the verified Slice 1 runner stage. Build it first at
``dist/agenta-local-runner-<platform>`` or pass ``--runner-stage``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from email.parser import BytesParser
from pathlib import Path, PurePosixPath

SERVICE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SERVICE_ROOT.parents[1]
PACKAGING_ROOT = Path(__file__).resolve().parent

PYTHON_VERSION = "3.13.15"
PYTHON_RELEASE = "20260814"
NODE_VERSION = "v24.19.0"
PBS_DOWNLOAD_BASE = (
    "https://github.com/astral-sh/python-build-standalone/releases/download/"
    f"{PYTHON_RELEASE}"
)
NODE_DIST_BASE = f"https://nodejs.org/dist/{NODE_VERSION}"

LOCAL_PACKAGES = ("agenta", "agenta-client", "agenta-local")
LOCAL_PROJECTS = (
    REPO_ROOT / "clients" / "python",
    REPO_ROOT / "sdks" / "python",
    SERVICE_ROOT,
)

CommandRunner = Callable[..., subprocess.CompletedProcess[str]]
Downloader = Callable[[str, Path], None]


class BuildError(RuntimeError):
    """The artifact could not be built safely or completely."""


@dataclass(frozen=True)
class PlatformPin:
    """Verified download pins for one bundle target platform.

    ``python_sha256``/``node_sha256`` embed upstream-verified digests where they
    were confirmed from this repository's Linux build host (linux-x64). For the
    darwin targets no trusted digest was confirmable from here: the value is
    ``None``, the computed SHA256 is recorded into the manifest at build time,
    and ``hash_verified_against_upstream`` stays false until a Mac operator
    compares it against the official checksum files (see BUILDING.md).
    """

    platform: str
    architecture: str
    triple: str
    node_version: str
    node_archive: str
    node_sha256: str | None
    python_sha256: str | None
    min_libc: str

    @property
    def node_url(self) -> str:
        return f"{NODE_DIST_BASE}/{self.node_archive}"

    @property
    def python_archive(self) -> str:
        return (
            f"cpython-{PYTHON_VERSION}+{PYTHON_RELEASE}-"
            f"{self.triple}-install_only_stripped.tar.gz"
        )

    @property
    def python_url(self) -> str:
        encoded = self.python_archive.replace("+", "%2B")
        return f"{PBS_DOWNLOAD_BASE}/{encoded}"


LINUX_NODE_SHA256 = "14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647"
LINUX_PYTHON_SHA256 = "aaca2af2ab4d7b68a712660d1334c0cfd5ec13c0312ccd30c29122d8d0342320"

PLATFORM_PINS: dict[str, PlatformPin] = {
    "linux-x64": PlatformPin(
        platform="linux-x64",
        architecture="x86_64",
        triple="x86_64-unknown-linux-gnu",
        node_version=NODE_VERSION,
        node_archive=f"node-{NODE_VERSION}-linux-x64.tar.xz",
        node_sha256=LINUX_NODE_SHA256,
        python_sha256=LINUX_PYTHON_SHA256,
        min_libc="glibc >= 2.28",
    ),
    "darwin-arm64": PlatformPin(
        platform="darwin-arm64",
        architecture="aarch64",
        triple="aarch64-apple-darwin",
        node_version=NODE_VERSION,
        node_archive=f"node-{NODE_VERSION}-darwin-arm64.tar.gz",
        node_sha256=None,
        python_sha256=None,
        min_libc="macOS >= 11",
    ),
    "darwin-x64": PlatformPin(
        platform="darwin-x64",
        architecture="x86_64",
        triple="x86_64-apple-darwin",
        node_version=NODE_VERSION,
        node_archive=f"node-{NODE_VERSION}-darwin-x64.tar.gz",
        node_sha256=None,
        python_sha256=None,
        min_libc="macOS >= 11",
    ),
}

SUPPORTED_PLATFORMS = tuple(PLATFORM_PINS)
PLATFORM_ENV_VAR = "AGENTA_LOCAL_BUNDLE_PLATFORM"


def detect_host_platform() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Linux" and machine in {"x86_64", "amd64"}:
        return "linux-x64"
    if system == "Darwin":
        if machine in {"arm64", "aarch64"}:
            return "darwin-arm64"
        if machine in {"x86_64", "amd64"}:
            return "darwin-x64"
    raise BuildError(f"unsupported build host: {system}/{machine}")


def resolve_target_platform(explicit: str | None, env_value: str | None) -> str:
    requested = explicit or env_value
    if requested is None:
        return detect_host_platform()
    if requested not in SUPPORTED_PLATFORMS:
        raise BuildError(
            f"unsupported platform {requested!r}; "
            f"supported platforms: {', '.join(SUPPORTED_PLATFORMS)}"
        )
    return requested


def native_component_names(platform_id: str) -> tuple[str, ...]:
    os_name, arch = platform_id.split("-", 1)
    return (
        f"@sandbox-agent/cli-{platform_id}",
        f"@esbuild/{os_name}-{arch}",
    )


_PNPM_STORE_NATIVE_RE = re.compile(
    r"^@(?:sandbox-agent\+cli|esbuild)\+"
    r"(?P<os>linux|darwin|android|freebsd|win32|aix)-(?P<arch>[a-z0-9]+)@"
)
_TOPLEVEL_NATIVE_RE = re.compile(
    r"^(?:cli-)?(?P<os>linux|darwin|android|freebsd|win32|aix)-(?P<arch>[a-z0-9]+)$"
)


def _native_platform_of(name: str) -> str | None:
    store_match = _PNPM_STORE_NATIVE_RE.match(name)
    if store_match:
        return f"{store_match.group('os')}-{store_match.group('arch')}"
    top_match = _TOPLEVEL_NATIVE_RE.match(name)
    if top_match:
        return f"{top_match.group('os')}-{top_match.group('arch')}"
    return None


def detect_installed_native_platforms(node_modules: Path) -> set[str]:
    """Report which OS/arch the runner node_modules was installed for.

    Scans the pnpm store and the hoisted @sandbox-agent/@esbuild scopes for the
    platform-specific binary packages. An empty result means the tree exposes
    no platform markers; callers then fall back to the stage manifest.
    """
    candidates: list[str] = []
    pnpm_store = node_modules / ".pnpm"
    if pnpm_store.is_dir():
        candidates.extend(entry.name for entry in pnpm_store.iterdir())
    for scope in ("@sandbox-agent", "@esbuild"):
        scoped = node_modules / scope
        if scoped.is_dir():
            candidates.extend(entry.name for entry in scoped.iterdir())
    found: set[str] = set()
    for name in candidates:
        detected = _native_platform_of(name)
        if detected:
            found.add(detected)
    return found


@dataclass(frozen=True)
class BuildConfig:
    platform: str
    output: Path
    runner_stage: Path
    web_output: Path
    migrations: Path
    python_archive: str | None = None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_command(
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise BuildError(f"command failed ({' '.join(command)}):\n{detail}")
    return result


def download(url: str, target: Path) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        source = Path(url).expanduser().resolve()
        if not source.is_file():
            raise BuildError(f"Python runtime archive not found: {source}")
        shutil.copy2(source, target)
        return
    with urllib.request.urlopen(url, timeout=120) as response, target.open("wb") as out:
        shutil.copyfileobj(response, out)


def _safe_archive_member(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts


def stage_python_runtime(
    pin: PlatformPin,
    archive_source: str | None,
    bundle: Path,
    scratch: Path,
    *,
    downloader: Downloader = download,
    command_runner: CommandRunner = run_command,
) -> tuple[str, bool]:
    """Stage the pinned CPython runtime for the target platform.

    Returns ``(sha256, hash_verified_against_pinned_digest)``. When the pin has
    no embedded digest (darwin targets) the computed digest is returned with
    ``False`` so the manifest can record it for manual upstream verification.
    """
    archive_path = scratch / pin.python_archive
    downloader(archive_source or pin.python_url, archive_path)
    actual_hash = sha256_file(archive_path)
    if pin.python_sha256 is not None and actual_hash != pin.python_sha256:
        raise BuildError(
            "Python runtime SHA256 mismatch: "
            f"got {actual_hash}, expected {pin.python_sha256}"
        )
    hash_verified = pin.python_sha256 is not None and actual_hash == pin.python_sha256

    extracted = scratch / "python-runtime"
    with tarfile.open(archive_path, "r:gz") as archive:
        unsafe = [
            member.name for member in archive if not _safe_archive_member(member.name)
        ]
        if unsafe:
            raise BuildError(f"Python runtime archive has unsafe member: {unsafe[0]}")
        archive.extractall(extracted, filter="data")
    source = extracted / "python"
    if not (source / "bin" / "python3").exists():
        raise BuildError("Python runtime archive is missing python/bin/python3")
    target = bundle / "runtime" / "python"
    shutil.copytree(source, target, symlinks=True)

    result = command_runner(
        [str(target / "bin" / "python3"), "--version"], cwd=bundle, env={}
    )
    reported = (result.stdout or result.stderr).strip()
    if reported != f"Python {PYTHON_VERSION}":
        raise BuildError(
            f"Python runtime reported {reported!r}, expected 'Python {PYTHON_VERSION}'"
        )

    runtime_license_files = [
        path
        for path in target.rglob("*")
        if path.is_file()
        and path.name.lower().startswith(("license", "copying", "notice"))
    ]
    if not runtime_license_files:
        raise BuildError("Python runtime archive contains no license texts")
    for source_license in runtime_license_files:
        license_target = (
            bundle / "licenses" / "python-runtime" / source_license.relative_to(target)
        )
        license_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_license, license_target)
    return actual_hash, hash_verified


def _read_checksum_file(root: Path) -> dict[str, str]:
    checksums: dict[str, str] = {}
    path = root / "SHA256SUMS"
    if not path.is_file():
        raise BuildError(f"runner stage is missing checksum file: {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        try:
            digest, relative = line.split("  ", 1)
        except ValueError as exc:
            raise BuildError(f"invalid runner checksum line: {line!r}") from exc
        checksums[relative] = digest
    return checksums


def validate_runner_stage(stage: Path, pin: PlatformPin) -> dict[str, object]:
    required = (
        stage / "runner" / "src",
        stage / "runner" / "dist",
        stage / "runner" / "node_modules",
        stage / "runner" / "package.json",
        stage / "runtime" / "node" / "bin" / "node",
        stage / "bin" / "sandbox-agent-wrapper",
        stage / "manifest.json",
    )
    missing = [str(path.relative_to(stage)) for path in required if not path.exists()]
    if missing:
        raise BuildError(
            f"verified runner stage {stage} is incomplete: {', '.join(missing)}"
        )
    checksums = _read_checksum_file(stage)
    for relative, expected in checksums.items():
        target = stage / relative
        if not target.is_file() or sha256_file(target) != expected:
            raise BuildError(f"runner stage checksum failed: {relative}")
    try:
        manifest = json.loads((stage / "manifest.json").read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BuildError(f"runner stage manifest is invalid: {exc}") from exc
    node = manifest.get("node", {})
    if node.get("version") != pin.node_version:
        raise BuildError(
            f"runner stage does not contain pinned Node {pin.node_version}"
        )
    recorded_arch = node.get("arch")
    if recorded_arch is not None and recorded_arch != pin.platform:
        raise BuildError(
            f"runner stage Node runtime is for {recorded_arch}, "
            f"but the target platform is {pin.platform}"
        )
    detected = detect_installed_native_platforms(stage / "runner" / "node_modules")
    if detected and pin.platform not in detected:
        installed_names = sorted(
            name for item in detected for name in native_component_names(item)
        )
        expected_names = ", ".join(native_component_names(pin.platform))
        raise BuildError(
            "runner stage node_modules holds native packages for the wrong "
            f"platform: {', '.join(installed_names)}; target {pin.platform} "
            f"expects {expected_names}. Cross-installed native dependencies are "
            f"unreliable: rebuild the S1.3 runner stage on the target OS, then "
            f"rerun with --platform {pin.platform} (see BUILDING.md)."
        )
    return manifest


def stage_runner(
    stage: Path, bundle: Path, pin: PlatformPin
) -> tuple[dict[str, object], str]:
    manifest = validate_runner_stage(stage, pin)
    for directory in ("runner", "runtime/node"):
        shutil.copytree(stage / directory, bundle / directory, symlinks=True)
    for source in (stage / "bin").iterdir():
        if source.name != "agenta-local":
            target = bundle / "bin" / source.name
            if source.is_dir():
                shutil.copytree(source, target, symlinks=True)
            else:
                shutil.copy2(source, target, follow_symlinks=False)
    if (stage / "licenses").is_dir():
        shutil.copytree(
            stage / "licenses", bundle / "licenses" / "runner", symlinks=True
        )
    return manifest, sha256_file(stage / "manifest.json")


def build_wheels(
    wheels: Path,
    *,
    command_runner: CommandRunner = run_command,
) -> list[Path]:
    wheels.mkdir(parents=True)
    built: list[Path] = []
    for project in LOCAL_PROJECTS:
        before = set(wheels.glob("*.whl"))
        command_runner(
            ["uv", "build", "--wheel", "--out-dir", str(wheels), str(project)],
            cwd=SERVICE_ROOT,
        )
        created = sorted(set(wheels.glob("*.whl")) - before)
        if len(created) != 1:
            raise BuildError(f"expected one wheel from {project}, found {len(created)}")
        built.extend(created)
    return built


def export_locked_requirements(
    target: Path,
    *,
    command_runner: CommandRunner = run_command,
) -> None:
    command = ["uv", "export", "--locked", "--no-dev", "--no-header", "--no-annotate"]
    for package in LOCAL_PACKAGES:
        command.extend(["--no-emit-package", package])
    command.extend(["--output-file", str(target)])
    command_runner(command, cwd=SERVICE_ROOT)
    text = target.read_text(encoding="utf-8")
    for package in LOCAL_PACKAGES:
        normalized = package.replace("-", "[-_.]")
        if re.search(rf"(?im)^{normalized}(?:\[.*\])?\s*(?:==|@)", text):
            raise BuildError(
                f"exported requirements still contain local package {package}"
            )
    if "-e " in text or str(REPO_ROOT) in text:
        raise BuildError("exported requirements contain an editable or checkout path")


def install_python_payload(
    bundle: Path,
    scratch: Path,
    *,
    command_runner: CommandRunner = run_command,
) -> None:
    requirements = scratch / "third-party-requirements.txt"
    export_locked_requirements(requirements, command_runner=command_runner)
    shutil.copy2(requirements, bundle / "licenses" / "python-requirements.txt")
    wheels = build_wheels(scratch / "wheels", command_runner=command_runner)
    python = bundle / "runtime" / "python" / "bin" / "python3"
    site_packages = bundle / "app" / "python" / "site-packages"
    site_packages.mkdir(parents=True)
    command_runner(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(python),
            "--target",
            str(site_packages),
            "--require-hashes",
            "--no-deps",
            "--requirements",
            str(requirements),
        ],
        cwd=SERVICE_ROOT,
    )
    command_runner(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(python),
            "--target",
            str(site_packages),
            "--no-deps",
            *[str(wheel) for wheel in wheels],
        ],
        cwd=SERVICE_ROOT,
    )
    shutil.rmtree(site_packages / "bin", ignore_errors=True)


def write_wrapper(bundle: Path) -> None:
    wrapper = bundle / "bin" / "agenta-local"
    wrapper.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        'ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\n'
        'export PYTHONPATH="$ROOT/app/python/site-packages"\n'
        "export PYTHONNOUSERSITE=1\n"
        "export PYTHONDONTWRITEBYTECODE=1\n"
        'exec "$ROOT/runtime/python/bin/python3" '
        '-m agenta_local.entrypoints.launcher "$@"\n',
        encoding="utf-8",
    )
    wrapper.chmod(0o755)


def installed_distributions(site_packages: Path) -> list[dict[str, str]]:
    distributions: list[dict[str, str]] = []
    for metadata_path in sorted(site_packages.glob("*.dist-info/METADATA")):
        metadata = BytesParser().parsebytes(metadata_path.read_bytes())
        distributions.append(
            {
                "name": metadata.get("Name", metadata_path.parent.name),
                "version": metadata.get("Version", "unknown"),
                "license": (
                    metadata.get("License-Expression")
                    or metadata.get("License")
                    or "not declared"
                ).splitlines()[0][:200],
            }
        )
    return distributions


def collect_package_licenses(bundle: Path) -> None:
    site_packages = bundle / "app" / "python" / "site-packages"
    destination = bundle / "licenses" / "python-packages"
    for dist_info in sorted(site_packages.glob("*.dist-info")):
        candidates = [path for path in dist_info.rglob("*") if path.is_file()]
        license_files = [
            path
            for path in candidates
            if path.name.lower().startswith(("license", "copying", "notice"))
        ]
        if not license_files:
            continue
        package_dir = destination / dist_info.name.removesuffix(".dist-info")
        for source in license_files:
            relative = source.relative_to(dist_info)
            target = package_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)


def write_notices(bundle: Path, distributions: list[dict[str, str]]) -> None:
    notice = (PACKAGING_ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    lines = [notice.rstrip(), "", "### Installed resolution", ""]
    lines.extend(
        f"- {item['name']} {item['version']} ({item['license']})"
        for item in distributions
    )
    (bundle / "THIRD_PARTY_NOTICES.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def write_manifest(
    bundle: Path,
    pin: PlatformPin,
    runner_manifest: dict[str, object],
    runner_manifest_sha256: str,
    distributions: list[dict[str, str]],
    python_sha256: str,
    python_hash_verified: bool,
) -> None:
    manifest = json.loads(
        (PACKAGING_ROOT / "manifest.json").read_text(encoding="utf-8")
    )
    manifest.update(
        {
            "target_platform": pin.platform,
            "target_arch": pin.architecture,
            "min_libc": pin.min_libc,
            "built_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "application": {
                "lockfile_sha256": sha256_file(SERVICE_ROOT / "uv.lock"),
                "requirements_file": "licenses/python-requirements.txt",
                "requirements_sha256": sha256_file(
                    bundle / "licenses" / "python-requirements.txt"
                ),
                "packages": distributions,
                "wheels": {
                    name: next(
                        (
                            item["version"]
                            for item in distributions
                            if item["name"].lower() == name
                        ),
                        "unknown",
                    )
                    for name in LOCAL_PACKAGES
                },
            },
            "runner_stage": {
                "manifest": runner_manifest,
                "source_manifest_sha256": runner_manifest_sha256,
            },
            "checksum_scope": "all regular files except SHA256SUMS itself",
        }
    )
    manifest["product"] = {"name": "agenta-local", "platform": pin.platform}
    manifest["python"] = {
        **manifest.get("python", {}),
        "architecture": pin.architecture,
        "archive": pin.python_archive,
        "url": pin.python_url,
        "sha256": python_sha256,
        "hash_verified_against_upstream": python_hash_verified,
        "libc": "glibc >= 2.17" if pin.platform == "linux-x64" else None,
    }
    manifest["requirements"] = {
        "host_utilities": ["/bin/sh", "dirname"],
        "overall_libc": pin.min_libc,
    }
    (bundle / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def _symlink_problems(root: Path) -> list[str]:
    problems: list[str] = []
    resolved_root = root.resolve()
    for path in root.rglob("*"):
        if not path.is_symlink():
            continue
        resolved = path.resolve()
        if not resolved.exists() or (
            resolved != resolved_root and resolved_root not in resolved.parents
        ):
            problems.append(str(path.relative_to(root)))
    return problems


def validate_payload(bundle: Path) -> None:
    forbidden_files = [
        path
        for path in bundle.rglob("*")
        if path.is_file() and (path.suffix == ".pth" or path.suffix == ".egg-link")
    ]
    editable = []
    forbidden = [str(REPO_ROOT).encode(), str(SERVICE_ROOT).encode(), b".pnpm-store"]
    checkout_hits: list[str] = []
    for path in bundle.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if path.name == "direct_url.json" and _contains_any(
            path, [b'"editable": true']
        ):
            editable.append(path)
        if path.name == "pyvenv.cfg":
            editable.append(path)
        with path.open("rb") as handle:
            shebang = handle.readline(512).lower()
        if (
            shebang.startswith(b"#!/")
            and b"python" in shebang
            and not shebang.startswith(b"#!/usr/bin/env ")
        ):
            checkout_hits.append(
                f"{path.relative_to(bundle)} (absolute Python shebang)"
            )
        if _contains_any(path, forbidden):
            checkout_hits.append(str(path.relative_to(bundle)))
    symlink_problems = _symlink_problems(bundle)
    if forbidden_files:
        raise BuildError(f"payload contains prohibited path file: {forbidden_files[0]}")
    if editable:
        raise BuildError(f"payload contains editable metadata: {editable[0]}")
    if checkout_hits:
        raise BuildError(f"payload contains checkout reference: {checkout_hits[0]}")
    if symlink_problems:
        raise BuildError(f"payload contains escaping symlink: {symlink_problems[0]}")


def _contains_any(path: Path, needles: list[bytes]) -> bool:
    overlap = max(len(needle) for needle in needles) - 1
    previous = b""
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            window = previous + chunk
            if any(needle in window for needle in needles):
                return True
            previous = window[-overlap:] if overlap else b""
    return False


def write_checksums(bundle: Path) -> None:
    lines = []
    for path in sorted(bundle.rglob("*")):
        if path.is_file() and not path.is_symlink() and path.name != "SHA256SUMS":
            lines.append(f"{sha256_file(path)}  {path.relative_to(bundle).as_posix()}")
    (bundle / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")


def make_read_only(root: Path) -> None:
    for path in sorted(root.rglob("*"), reverse=True):
        if path.is_symlink():
            continue
        mode = path.stat().st_mode
        if path.is_dir() or mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH):
            path.chmod(0o555)
        else:
            path.chmod(0o444)
    root.chmod(0o555)


def validate_sources(config: BuildConfig) -> None:
    missing = []
    if not config.web_output.is_dir():
        missing.append(f"renderer: {config.web_output}")
    if not config.migrations.is_dir():
        missing.append(f"migrations: {config.migrations}")
    if not config.runner_stage.is_dir():
        missing.append(f"verified runner stage: {config.runner_stage}")
    if missing:
        raise BuildError("missing bundle input(s): " + "; ".join(missing))
    if config.output.exists():
        raise BuildError(f"output already exists: {config.output}")


def build_bundle(
    config: BuildConfig,
    *,
    command_runner: CommandRunner = run_command,
    downloader: Downloader = download,
    pins: Mapping[str, PlatformPin] | None = None,
) -> Path:
    pin_map = PLATFORM_PINS if pins is None else pins
    try:
        pin = pin_map[config.platform]
    except KeyError as exc:
        raise BuildError(f"unknown platform: {config.platform}") from exc
    validate_sources(config)
    config.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="agenta-local-bundle-", dir=config.output.parent
    ) as scratch_name:
        scratch = Path(scratch_name)
        bundle = scratch / config.output.name
        (bundle / "bin").mkdir(parents=True)
        (bundle / "licenses").mkdir()

        runner_manifest, runner_manifest_sha256 = stage_runner(
            config.runner_stage, bundle, pin
        )
        python_sha256, python_hash_verified = stage_python_runtime(
            pin,
            config.python_archive,
            bundle,
            scratch,
            downloader=downloader,
            command_runner=command_runner,
        )
        install_python_payload(bundle, scratch, command_runner=command_runner)
        shutil.copytree(config.web_output, bundle / "app" / "web", symlinks=True)
        shutil.copytree(
            config.migrations,
            bundle / "app" / "migrations",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        write_wrapper(bundle)

        distributions = installed_distributions(
            bundle / "app" / "python" / "site-packages"
        )
        collect_package_licenses(bundle)
        write_notices(bundle, distributions)
        write_manifest(
            bundle,
            pin,
            runner_manifest,
            runner_manifest_sha256,
            distributions,
            python_sha256,
            python_hash_verified,
        )
        validate_payload(bundle)
        write_checksums(bundle)
        shutil.move(str(bundle), config.output)
    make_read_only(config.output)
    return config.output


def _default_config(args: argparse.Namespace, platform_id: str) -> BuildConfig:
    output = args.output or SERVICE_ROOT / f"dist/agenta-local-{platform_id}"
    runner_stage = (
        args.runner_stage or SERVICE_ROOT / f"dist/agenta-local-runner-{platform_id}"
    )
    return BuildConfig(
        platform=platform_id,
        output=output.resolve(),
        runner_stage=runner_stage.resolve(),
        web_output=args.web_output.resolve(),
        migrations=args.migrations.resolve(),
        python_archive=args.python_archive,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--platform",
        default=None,
        help=(
            "bundle target: one of "
            f"{', '.join(SUPPORTED_PLATFORMS)}; defaults to the host platform "
            f"(or ${PLATFORM_ENV_VAR})"
        ),
    )
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--runner-stage", type=Path, default=None)
    parser.add_argument(
        "--web-output", type=Path, default=REPO_ROOT / "web/agenta-local/out"
    )
    parser.add_argument(
        "--migrations",
        type=Path,
        default=SERVICE_ROOT / "databases/sqlite/migrations",
    )
    parser.add_argument(
        "--python-archive",
        help="local archive path or URL; still required to match the pinned SHA256",
    )
    args = parser.parse_args(argv)
    try:
        platform_id = resolve_target_platform(
            args.platform, os.environ.get(PLATFORM_ENV_VAR)
        )
        host_platform = detect_host_platform()
        if platform_id != host_platform:
            raise BuildError(
                f"refusing to build {platform_id} on {host_platform}: bundles must "
                "be assembled on the target OS because the runner node_modules "
                "carries OS-specific native packages (see BUILDING.md for the "
                "per-platform recipes)"
            )
        built = build_bundle(_default_config(args, platform_id))
    except (BuildError, OSError, tarfile.TarError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    size = sum(path.stat().st_size for path in built.rglob("*") if path.is_file())
    print(f"bundle: {built}")
    print(f"size: {size / (1024 * 1024):.1f} MiB")
    print(f"verify: uv run --no-sync python packaging/linux/verify_bundle.py {built}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
