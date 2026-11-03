"""The `browser` skill ships its scripts, sits in the catalogue, and joins agents only behind the flag."""

import shutil
import subprocess
from pathlib import Path

import pytest

from oss.src.core.browser.skill import BROWSER_SKILL, BROWSER_SLUG, SCRIPT_PATH
from oss.src.core.workflows import build_kit

API_DIR = Path(__file__).resolve().parents[5]
JS_TESTS = API_DIR / "oss" / "tests" / "js" / "browser"
SCRIPTS_DIR = API_DIR / "oss" / "src" / "core" / "browser" / "skill" / "scripts"


def test_skill_ships_every_script_file():
    on_disk = sorted(
        path.relative_to(SCRIPTS_DIR.parent).as_posix()
        for path in SCRIPTS_DIR.rglob("*.cjs")
    )
    assert [f.path for f in BROWSER_SKILL.files] == on_disk
    assert "scripts/agenta-browser.cjs" in on_disk
    assert "scripts/lib/cli.cjs" in on_disk


def test_skill_body_names_the_script_and_the_sign_in_rule():
    assert SCRIPT_PATH in BROWSER_SKILL.body
    assert "never type one" in BROWSER_SKILL.body
    assert "--intent pay" in BROWSER_SKILL.body


def _skill_slugs(overlay):
    return [
        s["@ag.embed"]["@ag.references"]["workflow"]["slug"] for s in overlay["skills"]
    ]


def test_build_kit_adds_the_skill_only_when_the_browser_is_on(monkeypatch):
    monkeypatch.setattr(build_kit.env.browser, "enabled", False)
    assert BROWSER_SLUG not in _skill_slugs(build_kit.build_agent_template_overlay())
    monkeypatch.setattr(build_kit.env.browser, "enabled", True)
    assert BROWSER_SLUG in _skill_slugs(build_kit.build_agent_template_overlay())


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_browser_script_node_tests_pass():
    test_files = sorted(str(path) for path in JS_TESTS.glob("*.test.cjs"))
    assert len(test_files) >= 6
    result = subprocess.run(
        ["node", "--test", "--test-reporter=spec", *test_files],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "\nℹ fail 0\n" in result.stdout
