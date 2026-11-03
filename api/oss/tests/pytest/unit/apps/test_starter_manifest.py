"""The board starter against the manifest rules (``manifest.ts``) and the app rules."""

from __future__ import annotations

import json
import re

import pytest

from oss.src.core.apps.service import (
    BUNDLE_STARTERS_DIR,
    AppsError,
    parse_starter_skill,
    validate_manifest,
)

BOARD = BUNDLE_STARTERS_DIR / "board@1"

# Mirror of KIT_CLASSES in protocol.ts; the starter may use no other `ag-*` class.
KIT_CLASSES = {
    "ag-app",
    "ag-toolbar",
    "ag-btn",
    "ag-btn-primary",
    "ag-input",
    "ag-select",
    "ag-check",
    "ag-card",
    "ag-columns",
    "ag-column",
    "ag-list",
    "ag-grid",
    "ag-badge",
    "ag-empty",
    "ag-toast",
}


def test_board_manifest_is_a_valid_app():
    manifest = validate_manifest((BOARD / "app.json").read_text())
    assert manifest["name"] == "Board"
    assert manifest["entry"] == "index.html"
    assert manifest["access"] == "read-write"
    assert manifest["data"] == ["board.json"]
    assert manifest["config"] == "config.json"
    assert manifest["kit"] is True
    assert "template" not in manifest  # stamped at copy, never in the bundle
    assert "extra" not in manifest


def test_starter_front_matter_agrees_with_the_manifest():
    info = parse_starter_skill((BOARD / "SKILL.md").read_text())
    manifest = validate_manifest((BOARD / "app.json").read_text())
    defaults = json.loads((BOARD / "config.defaults.json").read_text())
    assert list(info.data_files) == manifest["data"]
    assert info.access == manifest["access"]
    assert set(info.config_keys) <= set(defaults)


def test_index_html_uses_kit_classes_only_and_nothing_external():
    html = (BOARD / "index.html").read_text()
    # `--ag-*` are kit tokens, not classes; the lookbehind skips them.
    used = set(re.findall(r"(?<![-\w])ag-[a-z-]+", html))
    assert used <= KIT_CLASSES, used - KIT_CLASSES
    for forbidden in ("http://", "https://", "@import", "url(", "<link", "src="):
        assert forbidden not in html, forbidden
    assert "agenta.ready" in html
    assert 'addEventListener("changed"' in html
    assert "canWrite" in html


# --- manifest rules, one assertion each (mirrors htmlApp.manifest.test.ts) -------------


def _valid(**overrides):
    raw = {"agenta_app": 1, "name": "Retro"}
    raw.update(overrides)
    return json.dumps(raw)


@pytest.mark.parametrize(
    "text",
    [
        "not json",
        "[]",
        _valid(agenta_app=2),
        _valid(name=""),
        _valid(name="   "),
        json.dumps({"agenta_app": 1}),
        _valid(entry=""),
        _valid(entry="sub/index.html"),
        _valid(entry="..\\x.html"),
        _valid(entry="../index.html"),
    ],
)
def test_strict_rules_make_the_folder_not_an_app(text):
    with pytest.raises(AppsError) as info:
        validate_manifest(text)
    assert info.value.code == "invalid_manifest"


def test_defaults_apply():
    manifest = validate_manifest(_valid())
    assert manifest["entry"] == "index.html"
    assert manifest["access"] == "read"
    assert manifest["kit"] is True


def test_malformed_optional_fields_are_dropped_or_defaulted():
    manifest = validate_manifest(
        _valid(access="admin", kit="yes", data=[1, 2], config=3, refresh={"x": 1})
    )
    assert manifest["access"] == "read"
    assert manifest["kit"] is True
    assert "data" not in manifest
    assert "config" not in manifest
    assert "refresh" not in manifest


def test_optional_fields_round_trip():
    manifest = validate_manifest(
        _valid(
            icon="📋",
            template=None,
            access="read-write",
            data=["a.json"],
            config="c.json",
            kit=False,
            refresh={"prompt": "refresh"},
            tools=["drive.search"],
            custom={"x": 1},
        )
    )
    assert manifest["icon"] == "📋"
    assert manifest["template"] is None
    assert manifest["access"] == "read-write"
    assert manifest["data"] == ["a.json"]
    assert manifest["config"] == "c.json"
    assert manifest["kit"] is False
    assert manifest["refresh"] == {"prompt": "refresh"}
    assert manifest["tools"] == ["drive.search"]
    assert manifest["extra"] == {"custom": {"x": 1}}
