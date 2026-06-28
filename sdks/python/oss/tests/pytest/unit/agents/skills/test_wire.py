"""``skills_to_wire``: resolved ``SkillTemplate`` list -> the ``WireSkill[]`` runner contract.

The wire is camelCase to match ``services/agent/src/protocol.ts``; optional flags and ``files``
are omitted when unset so a minimal skill stays minimal.
"""

from __future__ import annotations

from agenta.sdk.agents import SkillTemplate, skills_to_wire


def test_skills_to_wire_empty():
    assert skills_to_wire([]) == []


def test_skills_to_wire_minimal():
    skills = [
        SkillTemplate(name="a", description="d", body="b"),
        SkillTemplate(name="c", description="e", body="f"),
    ]
    assert skills_to_wire(skills) == [
        {"name": "a", "description": "d", "body": "b"},
        {"name": "c", "description": "e", "body": "f"},
    ]


def test_skills_to_wire_full_shape():
    skill = SkillTemplate(
        name="release-notes",
        description="Draft release notes.",
        body="Read the changelog.",
        files=[{"path": "scripts/foo.py", "content": "print(1)", "executable": True}],
        disable_model_invocation=True,
        allow_executable_files=True,
    )
    assert skills_to_wire([skill]) == [
        {
            "name": "release-notes",
            "description": "Draft release notes.",
            "body": "Read the changelog.",
            "files": [
                {"path": "scripts/foo.py", "content": "print(1)", "executable": True}
            ],
            "disableModelInvocation": True,
            "allowExecutableFiles": True,
        }
    ]
