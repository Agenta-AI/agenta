"""The `browser` skill ships its script, sits in the catalogue, and joins agents only behind the flag."""

from oss.src.core.browser import skill as browser_skill
from oss.src.core.browser.skill import BROWSER_SKILL, BROWSER_SLUG, SCRIPT_PATH
from oss.src.core.workflows import build_kit
from oss.src.core.workflows.static_catalog import _STATIC_WORKFLOWS


def test_skill_bundles_the_browser_script():
    paths = [f.path for f in BROWSER_SKILL.files]
    assert paths == [SCRIPT_PATH]
    script = BROWSER_SKILL.files[0].content
    assert script.startswith("#!/usr/bin/env node")
    # The live view port and token path the runner's `/browser/live` reads.
    assert "AGENTA_BROWSER_PORT || 8790" in script
    assert '"/tmp/agenta-browser"' in script


def test_skill_body_names_the_script_and_the_sign_in_rule():
    assert SCRIPT_PATH in BROWSER_SKILL.body
    assert "never type one" in BROWSER_SKILL.body
    assert "--intent pay" in BROWSER_SKILL.body


def test_skill_is_in_the_static_catalogue():
    entry = _STATIC_WORKFLOWS[BROWSER_SLUG]
    assert entry["kind"] == "skill"
    revision = entry["versions"][entry["latest"]]
    assert revision.data.parameters["skill"]["name"] == "browser"


def _skill_slugs(overlay):
    return [
        s["@ag.embed"]["@ag.references"]["workflow"]["slug"] for s in overlay["skills"]
    ]


def test_build_kit_adds_the_skill_only_when_the_browser_is_on(monkeypatch):
    monkeypatch.setattr(build_kit.env.browser, "enabled", False)
    assert BROWSER_SLUG not in _skill_slugs(build_kit.build_agent_template_overlay())
    monkeypatch.setattr(build_kit.env.browser, "enabled", True)
    assert BROWSER_SLUG in _skill_slugs(build_kit.build_agent_template_overlay())


def test_skill_files_are_read_from_disk():
    assert (browser_skill.SKILL_DIR / SCRIPT_PATH).is_file()
