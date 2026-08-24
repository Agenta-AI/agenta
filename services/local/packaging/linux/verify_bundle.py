"""Verify hashes, relocation, read-only operation, and staged runtime imports.

Structural gates (layout, checksums, self-containment) run on any host. Gates
that execute bundle binaries (runtime probes, launch smoke) require the host to
match the bundle's ``target_platform``; on mismatch they are skipped with a
note. The optional strace network evidence gate (``--strace``) is Linux-only:
macOS has no strace, so requesting it there skips with a note.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import ipaddress
import json
import os
import platform as platform_lib
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SERVICE_ROOT.parents[1]
REQUIRED_COMPONENTS = {
    "launcher wrapper": "bin/agenta-local",
    "Python application": "app/python/site-packages",
    "renderer": "app/web",
    "migrations": "app/migrations",
    "runner source": "runner/src",
    "runner build": "runner/dist",
    "runner dependencies": "runner/node_modules",
    "runner package": "runner/package.json",
    "Python runtime": "runtime/python/bin/python3",
    "Node runtime": "runtime/node/bin/node",
    "licenses": "licenses",
    "manifest": "manifest.json",
    "third-party notices": "THIRD_PARTY_NOTICES.md",
    "checksums": "SHA256SUMS",
}


class VerificationError(RuntimeError):
    """A named bundle verification gate failed."""


def detect_host_platform() -> str:
    system = platform_lib.system()
    machine = platform_lib.machine().lower()
    if system == "Linux" and machine in {"x86_64", "amd64"}:
        return "linux-x64"
    if system == "Darwin":
        if machine in {"arm64", "aarch64"}:
            return "darwin-arm64"
        if machine in {"x86_64", "amd64"}:
            return "darwin-x64"
    raise VerificationError(f"unsupported verification host: {system}/{machine}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_layout(bundle: Path) -> None:
    for component, relative in REQUIRED_COMPONENTS.items():
        path = bundle / relative
        if not path.exists():
            raise VerificationError(f"{component} is missing: {path}")
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format_version") != 1:
        raise VerificationError("manifest has an unsupported format_version")


def validate_checksums(bundle: Path) -> None:
    expected: dict[str, str] = {}
    for line in (bundle / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        try:
            digest, relative = line.split("  ", 1)
        except ValueError as exc:
            raise VerificationError(f"checksums has malformed line: {line!r}") from exc
        if relative in expected:
            raise VerificationError(f"checksums lists duplicate file: {relative}")
        expected[relative] = digest
    actual = {
        path.relative_to(bundle).as_posix()
        for path in bundle.rglob("*")
        if path.is_file() and not path.is_symlink() and path.name != "SHA256SUMS"
    }
    missing = sorted(actual - set(expected))
    extra = sorted(set(expected) - actual)
    if missing:
        raise VerificationError(f"checksums does not cover file: {missing[0]}")
    if extra:
        raise VerificationError(f"checksums references missing file: {extra[0]}")
    for relative, digest in expected.items():
        if sha256_file(bundle / relative) != digest:
            raise VerificationError(f"checksum mismatch: {relative}")


def validate_self_contained(bundle: Path) -> None:
    bundle_root = bundle.resolve()
    forbidden = (
        str(REPO_ROOT).encode(),
        str(SERVICE_ROOT).encode(),
        b".pnpm-store",
        b'"editable": true',
    )
    for path in bundle.rglob("*"):
        if path.is_symlink():
            resolved = path.resolve()
            if not resolved.exists() or (
                resolved != bundle_root and bundle_root not in resolved.parents
            ):
                raise VerificationError(
                    f"symlink escapes the installation: {path.relative_to(bundle)}"
                )
            continue
        if not path.is_file():
            continue
        if path.suffix == ".pth":
            raise VerificationError(f"Python payload contains .pth file: {path}")
        if path.suffix == ".egg-link":
            raise VerificationError(
                f"Python payload contains editable egg-link: {path}"
            )
        if path.name == "pyvenv.cfg":
            raise VerificationError(f"bundle contains a virtual environment: {path}")
        with path.open("rb") as handle:
            shebang = handle.readline(512).lower()
        if (
            shebang.startswith(b"#!/")
            and b"python" in shebang
            and not shebang.startswith(b"#!/usr/bin/env ")
        ):
            raise VerificationError(
                f"bundle contains an absolute Python shebang: {path}"
            )
        if _contains_any(path, forbidden):
            raise VerificationError(
                f"checkout/editable reference found in {path.relative_to(bundle)}"
            )


def _contains_any(path: Path, needles: tuple[bytes, ...]) -> bool:
    overlap = max(len(needle) for needle in needles) - 1
    previous = b""
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            window = previous + chunk
            if any(needle in window for needle in needles):
                return True
            previous = window[-overlap:] if overlap else b""
    return False


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


def _runtime_env(bundle: Path) -> dict[str, str]:
    return {
        "HOME": tempfile.gettempdir(),
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": str(bundle / "app/python/site-packages"),
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }


def _run_component(
    component: str,
    command: list[str],
    *,
    bundle: Path,
    env: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            command,
            cwd=bundle,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise VerificationError(f"{component} timed out after 120 seconds") from exc
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise VerificationError(f"{component} failed ({result.returncode}): {detail}")
    return result


def validate_runtimes(bundle: Path) -> None:
    env = _runtime_env(bundle)
    python = bundle / "runtime/python/bin/python3"
    node = bundle / "runtime/node/bin/node"
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    expected_python = manifest["python"]["version"]
    expected_node = manifest["runner_stage"]["manifest"]["node"]["version"]

    python_version = _run_component(
        "Python runtime", [str(python), "--version"], bundle=bundle, env=env
    )
    reported_python = (python_version.stdout or python_version.stderr).strip()
    if reported_python != f"Python {expected_python}":
        raise VerificationError(
            f"Python runtime has unexpected version: {reported_python}"
        )
    node_version = _run_component(
        "Node runtime", [str(node), "--version"], bundle=bundle, env=env
    ).stdout.strip()
    if node_version != expected_node:
        raise VerificationError(f"Node runtime has unexpected version: {node_version}")

    probe = """
import importlib.util
import json
from importlib.metadata import version

for module in ("agenta", "agenta_client", "agenta_local", "agenta_local.entrypoints.server"):
    __import__(module)
launcher = importlib.util.find_spec("agenta_local.entrypoints.launcher") is not None
print(json.dumps({
    "agenta": version("agenta"),
    "agenta-client": version("agenta-client"),
    "agenta-local": version("agenta-local"),
    "launcher_available": launcher,
}))
"""
    result = _run_component(
        "staged Python imports", [str(python), "-c", probe], bundle=bundle, env=env
    )
    versions = json.loads(result.stdout)
    if versions["launcher_available"]:
        _run_component(
            "staged launcher import",
            [str(python), "-c", "import agenta_local.entrypoints.launcher"],
            bundle=bundle,
            env=env,
        )
    else:
        print("NOTE: launcher module is not yet present; staged server imports passed")

    syntax_probe = """
from pathlib import Path
import sys
root = Path(sys.argv[1])
for path in root.rglob("*.py"):
    compile(path.read_bytes(), str(path), "exec")
"""
    _run_component(
        "Python payload syntax",
        [str(python), "-c", syntax_probe, str(bundle / "app/python/site-packages")],
        bundle=bundle,
        env=env,
    )


def launch_smoke(bundle: Path, *, trace_path: Path | None = None) -> None:
    """Start the full supervisor, then require a clean signal-driven shutdown.

    With ``trace_path`` set, the supervisor tree runs under
    ``strace -f -e trace=network`` so the caller can classify outbound
    connect() targets; this requires Linux with strace installed.
    """
    command = [str(bundle / "bin/agenta-local"), "--no-browser"]
    if trace_path is not None:
        if sys.platform != "linux":
            raise VerificationError("the strace network gate requires Linux")
        if shutil.which("strace") is None:
            raise VerificationError("--strace requested but strace is not installed")
        command = [
            "strace",
            "-f",
            "-e",
            "trace=network",
            "-o",
            str(trace_path),
            *command,
        ]
    with tempfile.TemporaryDirectory(prefix="agenta-local-smoke-") as mutable_name:
        mutable = Path(mutable_name)
        env = _runtime_env(bundle)
        env.update(
            {
                "XDG_DATA_HOME": str(mutable / "data"),
                "XDG_STATE_HOME": str(mutable / "state"),
            }
        )
        process = subprocess.Popen(
            command,
            cwd=bundle,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            status = process.poll()
            if status is not None:
                stdout, stderr = process.communicate()
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                detail = stderr.strip() or stdout.strip() or "no launcher output"
                raise VerificationError(
                    f"launcher exited during startup ({status}): {detail}"
                )
            time.sleep(0.25)
        os.killpg(process.pid, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=45)
        except subprocess.TimeoutExpired as exc:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
            raise VerificationError(
                "launcher did not stop its process group after SIGTERM"
            ) from exc
        survivors = _bundle_processes(bundle)
        if survivors:
            for process_id in survivors:
                with contextlib.suppress(ProcessLookupError):
                    os.kill(process_id, signal.SIGKILL)
            raise VerificationError(
                "launcher left bundle processes after shutdown: "
                + ", ".join(str(process_id) for process_id in survivors)
            )
        if process.returncode:
            detail = stderr.strip() or stdout.strip() or "no launcher output"
            raise VerificationError(
                f"launcher shutdown failed ({process.returncode}): {detail}"
            )


def _bundle_processes(bundle: Path) -> list[int]:
    needle = str(bundle)
    if sys.platform == "linux":
        encoded = needle.encode()
        survivors: list[int] = []
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit() or int(entry.name) == os.getpid():
                continue
            try:
                command_line = (entry / "cmdline").read_bytes()
            except OSError:
                continue
            if encoded in command_line:
                survivors.append(int(entry.name))
        return survivors
    # Best-effort fallback for non-Linux hosts (no /proc): pgrep on the full
    # command line, excluding this verifier process itself.
    result = subprocess.run(
        ["pgrep", "-f", needle],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode not in (0, 1):
        return []
    return [
        int(line)
        for line in result.stdout.split()
        if line.isdigit() and int(line) != os.getpid()
    ]


STRACE_CONNECT_ADDR_RE = (
    r"sa_family=AF_INET\S*,\s+(?:sin6?_port|port)=htons\(\d+\),\s+"
    r"sin6?_addr=(?:inet_addr|inet_pton)\((?:AF_INET\S*,\s+)?\"([^\"]+)\"\)"
)


def classify_network_trace(trace_path: Path) -> tuple[list[str], list[str]]:
    """Split strace connect() destinations into (loopback, external).

    Mirrors the Slice 1 runner gate: loopback covers the runner, its DNS
    resolver, and the local service; anything else is reported for review.
    """
    text = trace_path.read_text(errors="ignore")
    destinations = {
        ip
        for line in text.splitlines()
        if "connect(" in line
        for ip in re.findall(STRACE_CONNECT_ADDR_RE, line)
    }
    loopback: list[str] = []
    external: list[str] = []
    for ip in sorted(destinations):
        address = ipaddress.ip_address(ip)
        if address.is_loopback:
            loopback.append(ip)
        elif ip not in {"0.0.0.0", "::"}:
            external.append(ip)
    return loopback, external


def _assert_network_local_only(trace_path: Path | None) -> None:
    if trace_path is None or not trace_path.is_file():
        return
    loopback, external = classify_network_trace(trace_path)
    if not loopback and not external:
        print("NOTE: strace captured no IPv4/IPv6 connect() calls (parse problem)")
        return
    print(f"strace network evidence: {len(loopback)} loopback connect() target(s)")
    if external:
        raise VerificationError(
            "bundle made non-loopback connections during smoke: " + ", ".join(external)
        )


def verify_bundle(
    bundle: Path,
    *,
    relocate: bool = True,
    launch: bool = False,
    strace: bool = False,
) -> Path:
    source = bundle.resolve()
    validate_layout(source)
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    host_platform = detect_host_platform()
    target_platform = manifest.get("target_platform")
    executable_here = target_platform is None or target_platform == host_platform
    strace_requested = strace
    if strace_requested and sys.platform != "linux":
        print(
            "NOTE: the strace network gate is Linux-only; "
            f"skipping it on {sys.platform}"
        )
        strace_requested = False
    if not executable_here:
        print(
            f"NOTE: bundle targets {target_platform} but this host is "
            f"{host_platform}; running structural gates only (runtime probes, "
            "launch smoke, and strace are skipped)"
        )

    def structural_gates(root: Path) -> None:
        validate_layout(root)
        validate_checksums(root)
        validate_self_contained(root)

    def execution_gates(root: Path) -> None:
        validate_runtimes(root)
        if launch:
            launch_smoke(root, trace_path=trace_path)
            _assert_network_local_only(trace_path)

    with tempfile.TemporaryDirectory(prefix="agenta-local-verify-") as scratch_name:
        trace_path: Path | None = None
        if strace_requested:
            if not launch:
                raise VerificationError("--strace requires the launch smoke")
            trace_path = Path(scratch_name) / "network.strace"

        if not relocate:
            structural_gates(source)
            if executable_here:
                execution_gates(source)
            return source

        temporary_parent = Path(tempfile.mkdtemp(prefix="agenta-bundle-"))
        copied = temporary_parent / f"agenta local bundle {secrets.token_hex(4)}"
        shutil.copytree(source, copied, symlinks=True)
        make_read_only(copied)
        try:
            structural_gates(copied)
            if executable_here:
                execution_gates(copied)
        finally:
            for path in sorted(copied.rglob("*")):
                if not path.is_symlink():
                    path.chmod(path.stat().st_mode | stat.S_IWUSR)
            copied.chmod(0o755)
            shutil.rmtree(copied, ignore_errors=True)
            shutil.rmtree(temporary_parent, ignore_errors=True)
    return source


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument(
        "--no-relocate", action="store_true", help="validate the supplied path in place"
    )
    parser.add_argument(
        "--skip-launch",
        action="store_true",
        help="skip the full supervisor startup and signal-driven shutdown smoke",
    )
    parser.add_argument(
        "--strace",
        action="store_true",
        help=(
            "capture the launch smoke under strace -f -e trace=network and fail on "
            "non-loopback connect() targets; Linux only (skipped with a note elsewhere)"
        ),
    )
    args = parser.parse_args(argv)
    try:
        verified = verify_bundle(
            args.bundle,
            relocate=not args.no_relocate,
            launch=not args.skip_launch,
            strace=args.strace,
        )
    except (OSError, ValueError, VerificationError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"verified bundle: {verified}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
