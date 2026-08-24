"""Offline unit tests for the runner staging builder's pure parts."""

import hashlib
import importlib.util
import os
from pathlib import Path

import pytest

_PACKAGING_DIR = Path(__file__).resolve().parents[3].parent / "packaging" / "runner"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, _PACKAGING_DIR / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_runner = _load("build_runner")


def test_manifest_contains_node_pin_constants():
    manifest = build_runner.build_manifest(
        generated_at_utc="2026-01-01T00:00:00+00:00",
        pnpm_version="10.30.0",
        dependency_versions={"sandbox-agent": "0.4.2"},
        daemon_rel="node_modules/@sandbox-agent/cli-linux-x64/bin/sandbox-agent",
        runner_name="agenta-runner",
        runner_version="0.1.0",
        lockfile_sha256="deadbeef",
        install_mode="preinstalled",
    )
    assert manifest["node"] == {
        "version": build_runner.NODE_VERSION,
        "url": build_runner.NODE_URL,
        "sha256": build_runner.NODE_SHA256,
        "arch": build_runner.NODE_ARCH,
    }
    for key in (
        "generated_at_utc",
        "runner",
        "mitigations",
        "pnpm_version",
        "dependency_versions",
        "daemon_binary",
        "known_open_items",
    ):
        assert key in manifest
    assert manifest["lockfile_sha256"] == "deadbeef"
    assert manifest["install_mode"] == "preinstalled"
    assert manifest["requirements"] == {"glibc": ">=2.28", "host_utils": ["/bin/sh"]}


def test_wrapper_script_content_is_exact():
    assert build_runner.wrapper_script(
        "runner/node_modules/@sandbox-agent/cli-linux-x64/bin/sandbox-agent"
    ) == (
        "#!/bin/sh\n"
        'exec "$(dirname "$0")/../runner/node_modules/@sandbox-agent/'
        'cli-linux-x64/bin/sandbox-agent" "$@" --no-telemetry\n'
    )


def test_symlink_checker_flags_escaping_link(tmp_path: Path):
    stage = tmp_path / "stage"
    (stage / "runner/node_modules/pkg").mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("leak")
    link = stage / "runner/node_modules/pkg/escape"
    os.symlink("../../../../outside/secret.txt", link)  # relative escape
    absolute = stage / "runner/node_modules/pkg/abs-escape"
    os.symlink(str(outside / "secret.txt"), absolute)  # absolute escape
    internal = stage / "runner/node_modules/pkg/internal"
    os.symlink("../pkg/index.js", internal)  # stays inside, dangling is fine to flag?
    (stage / "runner/node_modules/pkg/index.js").write_text("ok")

    problems = build_runner.verify_self_contained(stage)

    flagged = "\n".join(problems)
    assert str(link) in flagged
    assert str(absolute) in flagged
    # the internal link resolves inside the stage and must not be flagged
    escaping = [p for p in problems if p.startswith("symlink escapes")]
    assert len(escaping) == 2


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("node-v24.19.0-linux-x64/bin/node", True),
        ("node-v24.19.0-linux-x64/LICENSE", True),
        ("../evil.sh", False),
        ("/etc/passwd", False),
        ("a/../../b", False),
    ],
)
def test_tarball_member_safety_validator(name: str, expected: bool):
    assert build_runner.member_is_safe(name) is expected


def test_sha256sums_round_trip(tmp_path: Path):
    tree = tmp_path / "tree"
    (tree / "sub").mkdir(parents=True)
    (tree / "sub/a.txt").write_text("alpha")
    (tree / "b.bin").write_bytes(b"\x00\x01\x02")
    (tree / "empty.txt").touch()  # zero-byte files are hashed like any other

    sums_path = build_runner.write_checksums(tree)
    lines = sums_path.read_text().strip().splitlines()

    assert len(lines) == 3
    by_rel = {rel: digest for digest, rel in (line.split("  ", 1) for line in lines)}
    for rel, digest in by_rel.items():
        assert digest == hashlib.sha256((tree / rel).read_bytes()).hexdigest()
    assert build_runner.verify_checksums(tree, sums_path) == []
    (tree / "sub/a.txt").write_text("mutated")
    problems = build_runner.verify_checksums(tree, sums_path)
    assert problems == ["hash mismatch: sub/a.txt"]


def test_scan_streams_large_text_and_binaries(tmp_path: Path):
    root = str(build_runner.REPO_ROOT)
    store = "/some/.pnpm-store"
    stage = tmp_path / "stage"
    stage.mkdir(parents=True)

    big = stage / "bundle.js"  # >4MB: must be scanned despite the old size cap
    big.write_text("x" * (5 * 1024 * 1024) + f"{root} tail\n")
    text_store = stage / "store-note.txt"
    text_store.write_text(f"cache at {store}\n")
    binary_root = stage / "native.node"
    binary_root.write_bytes(b"\x7fELF\0" + os.urandom(32) + root.encode())
    binary_store = stage / "other.node"  # binaries only check the repo-root needle
    binary_store.write_bytes(b"\x7fELF\0" + store.encode())

    hits = build_runner.scan_for_paths(stage, [root, ".pnpm-store"])

    flagged = "\n".join(hits)
    assert "bundle.js" in flagged
    assert "store-note.txt" in flagged
    assert "native.node" in flagged
    assert "other.node" not in flagged
