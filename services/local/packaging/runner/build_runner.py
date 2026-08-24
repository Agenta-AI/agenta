"""Build a relocatable, self-contained runner stage. Slice 1 work packet S1.3.

Usage:
    uv run --no-sync python packaging/runner/build_runner.py --output <stage-dir> \
        [--runner-src <path>] [--node-tarball <path-or-url>] \
        [--install] [--skip-extension-build]

The staged tree is launched with the bundled Node against node_modules/tsx directly;
no pnpm/corepack/checkout is needed at runtime. See verify_runner.py for the proof.
"""

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import BinaryIO

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_RUNNER_SRC = REPO_ROOT / "services" / "runner"

# Verified pin: ~30MB, glibc >= 2.28, linux-x64.
NODE_VERSION = "v24.19.0"
NODE_ARCH = "linux-x64"
NODE_TARBALL_NAME = f"node-{NODE_VERSION}-{NODE_ARCH}.tar.xz"
NODE_URL = f"https://nodejs.org/dist/{NODE_VERSION}/{NODE_TARBALL_NAME}"
NODE_SHA256 = "14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647"

REQUIRED_SOURCE_ENTRIES = (
    "package.json",
    "pnpm-lock.yaml",
    "patches",
    "scripts",
    "config",
    "skills",
    "src",
)
STAGED_COPY_ITEMS = REQUIRED_SOURCE_ENTRIES + ("dist", "node_modules")
DAEMON_REL_FALLBACK = "node_modules/@sandbox-agent/cli-linux-x64/bin/sandbox-agent"

WRAPPER_REL_DEPTH = "../"


class BuildError(RuntimeError):
    pass


def _run(cmd: list[str], *, cwd: Path) -> None:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise BuildError(f"{' '.join(cmd)} failed:\n{result.stderr}")
    print(result.stdout, end="")


@dataclass
class StagingPlan:
    runner_src: Path
    output: Path
    runner_dir: Path = field(init=False)
    runtime_node_dir: Path = field(init=False)
    bin_dir: Path = field(init=False)
    licenses_dir: Path = field(init=False)

    def __post_init__(self) -> None:
        self.runner_dir = self.output / "runner"
        self.runtime_node_dir = self.output / "runtime" / "node"
        self.bin_dir = self.output / "bin"
        self.licenses_dir = self.output / "licenses"


def plan_staging(*, runner_src: Path, output: Path) -> StagingPlan:
    """Resolve paths without touching the filesystem."""
    return StagingPlan(runner_src=runner_src.resolve(), output=output.resolve())


def validate_source(plan: StagingPlan, *, install: bool = False) -> str:
    """Check required entries; returns install_mode: preinstalled | frozen-lockfile."""
    src = plan.runner_src
    missing = [name for name in REQUIRED_SOURCE_ENTRIES if not (src / name).exists()]
    if missing:
        raise BuildError(f"runner source {src} is missing: {', '.join(missing)}")
    if (src / "node_modules").is_dir():
        return "preinstalled"
    if not install:
        print(
            "error: runner node_modules is missing. Run exactly:\n"
            f"  cd {src}\n"
            "  corepack pnpm install --frozen-lockfile\n"
            "(or rerun this build with --install)",
            file=sys.stderr,
        )
        raise BuildError("runner node_modules missing; install first or pass --install")
    print(
        f"node_modules missing; running in {src}: corepack pnpm install --frozen-lockfile"
    )
    _run(["corepack", "pnpm", "install", "--frozen-lockfile"], cwd=src)
    return "frozen-lockfile"


def build_extension(plan: StagingPlan) -> None:
    """Rebuild extension assets unconditionally (idempotent; mirrors Dockerfile.gh)."""
    print("building extension assets: corepack pnpm run build:extension")
    _run(["corepack", "pnpm", "run", "build:extension"], cwd=plan.runner_src)


def apply_pi_validation_patch(plan: StagingPlan) -> bool:
    """Apply the Pi validation-message patch to SOURCE node_modules (idempotent).

    This mutates the source checkout's node_modules, exactly as the production
    image build does; the patch script exits 0 when already applied.
    """
    script = plan.runner_src / "scripts" / "patch-pi-validation-message.ts"
    result = subprocess.run(
        [
            str(plan.runner_src / "node_modules" / ".bin" / "tsx"),
            str(script),
        ],
        cwd=plan.runner_src,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise BuildError(
            f"pi validation patch failed ({result.returncode}):\n{result.stderr}"
        )
    already = "already" in (result.stdout + result.stderr).lower()
    return not already


def stage_source(plan: StagingPlan) -> int:
    """Copy runner tree into <out>/runner preserving symlinks. Returns item count."""
    plan.runner_dir.mkdir(parents=True)
    count = 0
    for item in STAGED_COPY_ITEMS:
        source = plan.runner_src / item
        target = plan.runner_dir / item
        if source.is_symlink() and not source.exists():
            continue
        if source.is_dir():
            shutil.copytree(
                source,
                target,
                symlinks=True,
                ignore_dangling_symlinks=True,
            )
            count += sum(len(files) for _, _, files in os.walk(target))
        else:
            shutil.copy2(source, target)
            count += 1
    return count


def member_is_safe(name: str) -> bool:
    """Reject absolute paths and parent traversals in archive member names."""
    posix = PurePosixPath(name)
    return not posix.is_absolute() and ".." not in posix.parts


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_node_tarball(node_tarball: str | None, scratch: Path) -> Path:
    """Return a local tarball path, downloading the pinned release if given a URL."""
    if node_tarball is None:
        node_tarball = NODE_URL
    parsed = urllib.parse.urlparse(node_tarball)
    if parsed.scheme in ("http", "https"):
        target = scratch / NODE_TARBALL_NAME
        print(f"downloading {node_tarball}")
        with (
            urllib.request.urlopen(node_tarball, timeout=60) as response,
            target.open("wb") as out,
        ):
            shutil.copyfileobj(response, out)
        return target
    local = Path(node_tarball).expanduser().resolve()
    if not local.is_file():
        raise BuildError(f"node tarball not found: {local}")
    return local


def acquire_node(
    plan: StagingPlan,
    *,
    node_tarball: str | None,
    scratch: Path,
) -> None:
    """Verify sha256, extract bin/node + LICENSE, and prove the binary runs bare."""
    tar_path = fetch_node_tarball(node_tarball, scratch)
    actual_sha = _sha256_file(tar_path)
    if actual_sha != NODE_SHA256:
        raise BuildError(
            f"node tarball sha256 mismatch: got {actual_sha}, want {NODE_SHA256}"
        )
    plan.runtime_node_dir.mkdir(parents=True, exist_ok=True)
    extracted: dict[str, Path] = {}
    prefix = f"node-{NODE_VERSION}-{NODE_ARCH}/"
    wanted = {f"{prefix}bin/node": plan.runtime_node_dir / "bin" / "node"}
    with tarfile.open(tar_path, "r:xz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            if member.name in wanted:
                if not member_is_safe(member.name):
                    raise BuildError(f"unsafe tarball member: {member.name}")
                extracted[member.name] = wanted[member.name]
            elif member.name == f"{prefix}LICENSE":
                extracted[member.name] = plan.runtime_node_dir / "LICENSE"
            else:
                continue
    for name, target in extracted.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(tar_path, "r:xz") as archive:
            handle = archive.extractfile(name)
            if handle is None:
                raise BuildError(f"cannot read tarball member {name}")
            with handle, target.open("wb") as out:
                shutil.copyfileobj(handle, out)
    node_bin = wanted[f"{prefix}bin/node"]
    node_bin.chmod(0o755)
    license_path = plan.runtime_node_dir / "LICENSE"
    if license_path.is_file():
        plan.licenses_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(license_path, plan.licenses_dir / "node-LICENSE")
    # Prove the binary is self-contained with an empty environment.
    probe = subprocess.run(
        [str(node_bin), "--version"],
        capture_output=True,
        text=True,
        env={},
        timeout=30,
        check=False,
    )
    if probe.returncode != 0 or probe.stdout.strip() != NODE_VERSION:
        raise BuildError(
            f"staged node failed bare --version probe: rc={probe.returncode} "
            f"out={probe.stdout!r} err={probe.stderr!r}"
        )
    print(f"staged node OK: {probe.stdout.strip()}")


def find_daemon_binary(runner_root: Path) -> str:
    """Locate the sandbox-agent daemon ELF under runner/node_modules (relative)."""
    direct = runner_root / DAEMON_REL_FALLBACK
    if direct.exists():
        return DAEMON_REL_FALLBACK
    platform = "linux-x64"
    store = runner_root / "node_modules" / ".pnpm"
    if store.is_dir():
        for entry in sorted(store.iterdir()):
            candidate_rel = (
                f"node_modules/.pnpm/{entry.name}/node_modules/"
                f"@sandbox-agent/cli-{platform}/bin/sandbox-agent"
            )
            if (
                entry.name.startswith(f"@sandbox-agent+cli-{platform}")
                and (runner_root / candidate_rel).exists()
            ):
                return candidate_rel
    raise BuildError("sandbox-agent daemon binary not found in runner node_modules")


def wrapper_script(daemon_rel: str) -> str:
    """Exact POSIX sh wrapper appending the --no-telemetry kill switch."""
    return (
        "#!/bin/sh\n"
        f'exec "$(dirname "$0")/{WRAPPER_REL_DEPTH}{daemon_rel}" '
        '"$@" --no-telemetry\n'
    )


def write_wrapper(plan: StagingPlan, daemon_rel: str) -> Path:
    plan.bin_dir.mkdir(parents=True, exist_ok=True)
    wrapper = plan.bin_dir / "sandbox-agent-wrapper"
    wrapper.write_text(wrapper_script(daemon_rel))
    wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return wrapper


def _run_json(cmd: list[str], cwd: Path) -> object:
    result = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, timeout=120, check=False
    )
    if result.returncode != 0:
        raise BuildError(f"{cmd[0]} failed:\n{result.stderr}")
    return json.loads(result.stdout)


def collect_dependency_versions(runner_src: Path) -> tuple[str, dict[str, str]]:
    """Top-level dependency versions plus the pnpm version used, from SOURCE."""
    listing = _run_json(
        ["corepack", "pnpm", "ls", "--depth", "0", "--json"], runner_src
    )
    versions: dict[str, str] = {}
    if isinstance(listing, list) and listing:
        for section in ("dependencies", "devDependencies"):
            for name, info in (listing[0].get(section) or {}).items():
                versions[name] = info.get("version", "?")
    return _pnpm_version(runner_src), versions


def _pnpm_version(runner_src: Path) -> str:
    result = subprocess.run(
        ["corepack", "pnpm", "--version"],
        cwd=runner_src,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        raise BuildError(f"pnpm --version failed:\n{result.stderr}")
    return result.stdout.strip()


MITIGATIONS = [
    (
        "npm_config_offline=true is set in the runner child env so pi-acp never "
        "runs `npm view @earendil-works/pi-coding-agent version` (update banner)"
    ),
    (
        "SANDBOX_AGENT_BIN points at bin/sandbox-agent-wrapper, which execs the "
        "real daemon ELF with appended --no-telemetry (only kill switch at 0.4.2)"
    ),
    "XDG_DATA_HOME must be redirected to a fresh empty writable dir at launch time",
]

KNOWN_OPEN_ITEMS = [
    (
        "pi-acp patch hardening (buildUpdateNotice -> null stub) deferred; env "
        "mitigation npm_config_offline suffices today"
    ),
    "full THIRD_PARTY notices deferred to Slice 4",
]


def build_manifest(
    *,
    generated_at_utc: str,
    pnpm_version: str,
    dependency_versions: dict[str, str],
    daemon_rel: str,
    runner_name: str,
    runner_version: str,
    lockfile_sha256: str,
    install_mode: str,
) -> dict[str, object]:
    return {
        "node": {
            "version": NODE_VERSION,
            "url": NODE_URL,
            "sha256": NODE_SHA256,
            "arch": NODE_ARCH,
        },
        "generated_at_utc": generated_at_utc,
        "runner": {"name": runner_name, "version": runner_version},
        "launch": {
            "entrypoint": "node node_modules/tsx/dist/cli.mjs src/server.ts",
            "note": "tsx stays on the runtime path: PKG_ROOT and the Pi asset "
            "resolvers derive from import.meta.url of the source tree",
        },
        "mitigations": MITIGATIONS,
        "pnpm_version": pnpm_version,
        "dependency_versions": dependency_versions,
        "daemon_binary": daemon_rel,
        "lockfile_sha256": lockfile_sha256,
        "install_mode": install_mode,
        "requirements": {"glibc": ">=2.28", "host_utils": ["/bin/sh"]},
        "known_open_items": KNOWN_OPEN_ITEMS,
    }


def write_manifest(manifest_path: Path, manifest: dict[str, object]) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def verify_self_contained(stage: Path) -> list[str]:
    """Every symlink in the stage must resolve inside the stage root."""
    problems: list[str] = []
    stage_real = stage.resolve()
    for root, dirs, files in os.walk(stage, topdown=True):
        entries = dirs + files
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        for entry in entries:
            candidate = Path(root) / entry
            if not candidate.is_symlink():
                continue
            resolved = candidate.resolve()
            if stage_real not in resolved.parents and resolved != stage_real:
                problems.append(f"symlink escapes stage: {candidate} -> {resolved}")
            elif not resolved.exists():
                problems.append(f"dangling symlink: {candidate} -> {resolved}")
    return problems


SNIFF_BYTES = 8192
SCAN_CHUNK_BYTES = 1 << 20


def _stream_find(handle: BinaryIO, head: bytes, needles: list[bytes]) -> bytes | None:
    """Search a stream chunk-wise, carrying overlaps across chunk boundaries."""
    overlap = max(len(needle) for needle in needles) - 1
    window = head
    while True:
        for needle in needles:
            if needle in window:
                return needle
        chunk = handle.read(SCAN_CHUNK_BYTES)
        if not chunk:
            return None
        window = (window[-overlap:] + chunk) if overlap else chunk


def scan_for_paths(stage: Path, forbidden: list[str]) -> list[str]:
    """Stream-scan staged files for checkout/store absolute paths.

    Text files check every needle; binaries (NUL sniff, ELF magic, .node suffix)
    check only the repo root. No size cap: large JS bundles are scanned too.
    """
    hits: list[str] = []
    text_needles = [needle.encode() for needle in forbidden]
    binary_needles = [str(REPO_ROOT).encode()]
    for path in stage.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            with path.open("rb") as handle:
                head = handle.read(SNIFF_BYTES)
                binary = (
                    b"\0" in head
                    or head.startswith(b"\x7fELF")
                    or path.suffix == ".node"
                )
                matched = _stream_find(
                    handle, head, binary_needles if binary else text_needles
                )
        except OSError:
            continue
        if matched is not None:
            kind = "binary" if binary else "text"
            needle_text = matched.decode("utf-8", errors="replace")
            hits.append(f"{path.relative_to(stage)} ({kind}) contains {needle_text!r}")
    return hits


def checksum_lines(stage: Path) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    for path in sorted(stage.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(stage).as_posix()
        entries.append((rel, _sha256_file(path)))
    return entries


def write_checksums(stage: Path) -> Path:
    sums_path = stage / "SHA256SUMS"
    lines = [f"{digest}  {rel}" for rel, digest in checksum_lines(stage)]
    sums_path.write_text("\n".join(lines) + "\n")
    return sums_path


def verify_checksums(stage: Path, sums_path: Path) -> list[str]:
    problems: list[str] = []
    for line in sums_path.read_text().splitlines():
        if not line.strip():
            continue
        digest, rel = line.split("  ", 1)
        target = stage / rel
        if not target.is_file():
            problems.append(f"missing: {rel}")
        elif _sha256_file(target) != digest:
            problems.append(f"hash mismatch: {rel}")
    return problems


def _du_sh(path: Path) -> str:
    result = subprocess.run(
        ["du", "-sh", str(path)],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    return result.stdout.split()[0] if result.returncode == 0 else "?"


def print_summary(plan: StagingPlan, file_count: int) -> None:
    print("\n=== stage summary ===")
    for sub in ("runner", "runtime", "bin", "licenses"):
        target = plan.output / sub
        size = _du_sh(target) if target.exists() else "-"
        print(f"{sub:<10} {size:>8}")
    print(f"files      {file_count:>8}")
    print(
        "verify:\n"
        "  cd services/local && uv run --no-sync python packaging/runner/"
        f"verify_runner.py {plan.output} --skip-turn"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--runner-src", type=Path, default=DEFAULT_RUNNER_SRC)
    parser.add_argument("--node-tarball", default=None)
    parser.add_argument(
        "--install",
        action="store_true",
        help="run corepack pnpm install --frozen-lockfile when node_modules is absent",
    )
    parser.add_argument(
        "--skip-extension-build",
        action="store_true",
        help="stage dist/extensions as-is instead of rebuilding",
    )
    args = parser.parse_args(argv)

    plan = plan_staging(runner_src=args.runner_src, output=Path(args.output))
    install_mode = validate_source(plan, install=args.install)
    lockfile_sha256 = _sha256_file(plan.runner_src / "pnpm-lock.yaml")
    if args.skip_extension_build:
        print("note: --skip-extension-build given; staging dist/extensions as-is")
    else:
        build_extension(plan)
    patched = apply_pi_validation_patch(plan)
    print(
        "note: pi validation patch mutates SOURCE node_modules "
        "(same as production image build)"
    )

    if plan.output.exists():
        raise BuildError(f"output already exists: {plan.output}")
    plan.output.mkdir(parents=True)

    file_count = stage_source(plan)
    print(f"staged {file_count} files into {plan.runner_dir}")

    with tempfile.TemporaryDirectory(prefix="agenta-node-dl-") as scratch_name:
        acquire_node(plan, node_tarball=args.node_tarball, scratch=Path(scratch_name))

    daemon_rel = find_daemon_binary(plan.runner_dir)
    write_wrapper(plan, f"runner/{daemon_rel}")
    print(f"sandbox-agent wrapper -> ../runner/{daemon_rel}")

    runner_pkg = json.loads((plan.runner_dir / "package.json").read_text())
    pnpm_version, dep_versions = collect_dependency_versions(plan.runner_src)
    manifest = build_manifest(
        generated_at_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        pnpm_version=pnpm_version,
        dependency_versions=dep_versions,
        daemon_rel=daemon_rel,
        runner_name=runner_pkg.get("name", "?"),
        runner_version=runner_pkg.get("version", "?"),
        lockfile_sha256=lockfile_sha256,
        install_mode=install_mode,
    )
    write_manifest(plan.output / "manifest.json", manifest)

    problems = verify_self_contained(plan.output)
    forbidden = [str(REPO_ROOT), ".pnpm-store"]
    problems += scan_for_paths(plan.output, forbidden)
    if problems:
        for problem in problems:
            print(f"self-containment problem: {problem}", file=sys.stderr)
        raise BuildError(f"{len(problems)} self-containment problem(s)")
    write_checksums(plan.output)
    print("self-containment checks passed; SHA256SUMS written")

    if not patched:
        print("note: pi validation patch was already applied")

    print_summary(plan, file_count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
