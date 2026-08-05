"""The task suite: base configs, natural-language tasks, and automatic checkers.

Every checker receives the final config the engine produced and returns None on success
or a short failure string.
"""

import copy
from typing import Any, Callable, Dict, List, Optional

# --------------------------------------------------------------------------------------
# The base configuration: one realistic agent template
# --------------------------------------------------------------------------------------

AGENTS_MD = """# Release QA agent

You help the team ship a release. You check the build, you run the QA suite, and you
write the release notes.

## How you work

Always read the changelog before you start. Run the checks manually when the suite is
unavailable. Report every failure with its full log line.

## Tone

Be brief. Use short sentences. Do not use emojis.
"""

RELEASE_QA_BODY = """# Release QA

Run this skill before every release.

1. Pull the release branch.
2. Run the smoke suite with `pytest -m smoke`.
3. Check the deploy logs for errors.
4. Post the result in the release channel.

Escalate to the on-call engineer when step 2 fails.
"""

CHANGELOG_BODY = """# Changelog writer

Write one entry per merged pull request.

Keep each entry to one sentence. Link the pull request. Group entries by area.
"""

BASE_CONFIG: Dict[str, Any] = {
    "parameters": {
        "agent": {
            "llm": {
                "model": "anthropic/claude-sonnet-5",
                "max_tokens": 8192,
            },
            "instructions": {
                "agents_md": AGENTS_MD,
            },
            "skills": [
                {
                    "name": "release-qa",
                    "description": "Run the release QA suite.",
                    "body": RELEASE_QA_BODY,
                    "allow_executable_files": False,
                    "files": [
                        {
                            "path": "checklist.md",
                            "content": "- [ ] smoke suite\n- [ ] deploy logs\n",
                            "executable": False,
                        }
                    ],
                },
                {
                    "name": "changelog-writer",
                    "description": "Write the changelog.",
                    "body": CHANGELOG_BODY,
                    "allow_executable_files": False,
                    "files": [],
                },
                {
                    "name": "triage",
                    "description": "Triage incoming issues.",
                    "body": "# Triage\n\nLabel the issue. Assign a priority.\n",
                    "allow_executable_files": False,
                    "files": [],
                },
            ],
            "tools": [
                {"type": "builtin", "name": "read_file"},
                {"type": "builtin", "name": "write_file"},
                {
                    "type": "gateway",
                    "name": "send-slack-message",
                    "integration": "slack",
                    "action": "post_message",
                },
            ],
            "mcps": [
                {
                    "name": "github",
                    "transport": "http",
                    "url": "https://mcp.github.example/sse",
                },
                {
                    "name": "linear",
                    "transport": "http",
                    "url": "https://mcp.linear.example/sse",
                },
            ],
        }
    }
}

HEAD_REVISION_ID = "019c8a10-0000-7000-8000-000000000001"
NEW_HEAD_REVISION_ID = "019c8a10-0000-7000-8000-000000000002"

# The simulated workspace the runner can read. Keys are paths relative to the repo root.
WORKSPACE: Dict[str, str] = {
    ".agenta-imports/pdf-tools/SKILL.md": (
        "---\nname: pdf-tools\ndescription: Make and merge PDF files.\n---\n"
        "# PDF tools\n\nMake and merge PDF files.\n\n"
        "Use `pdftk` to merge. Use `weasyprint` to render HTML to PDF.\n"
    ),
    ".agenta-imports/pdf-tools/reference.md": (
        "# Reference\n\n- merge: `pdftk a.pdf b.pdf cat output out.pdf`\n"
        "- render: `weasyprint in.html out.pdf`\n"
    ),
    ".agenta-imports/deploy-helper/SKILL.md": (
        "---\nname: deploy-helper\ndescription: Deploy the service.\n---\n"
        "# Deploy helper\n\nRun `scripts/run.sh` to deploy.\n\n"
        "Check the health endpoint afterwards.\n"
    ),
    ".agenta-imports/deploy-helper/scripts/run.sh": (
        "#!/usr/bin/env bash\nset -euo pipefail\n"
        'echo "deploying $1"\ncurl -fsS "$DEPLOY_HOOK"\n'
    ),
    # The same folder, misplaced. Task (h) points here first.
    "scratch/pdf-tools/SKILL.md": (
        "---\nname: pdf-tools\ndescription: Make and merge PDF files.\n---\n"
        "# PDF tools\n\nA stale copy. Do not import this.\n"
    ),
}

IMPORT_ROOT = ".agenta-imports/"


# --------------------------------------------------------------------------------------
# Helpers for the checkers
# --------------------------------------------------------------------------------------


def agent(config: Dict[str, Any]) -> Dict[str, Any]:
    return config["parameters"]["agent"]


def find(items: List[Dict[str, Any]], key: str, value: str) -> Optional[Dict[str, Any]]:
    for item in items:
        if item.get(key) == value:
            return item
    return None


def unchanged_except(
    config: Dict[str, Any], *, allowed: List[str]
) -> Optional[str]:
    """Every top-level agent branch outside `allowed` must equal the base."""
    base = agent(BASE_CONFIG)
    got = agent(config)
    for branch in ("llm", "instructions", "skills", "tools", "mcps"):
        if branch in allowed:
            continue
        if got.get(branch) != base.get(branch):
            return f"collateral damage: '{branch}' changed but should not have"
    return None


# --------------------------------------------------------------------------------------
# The tasks
# --------------------------------------------------------------------------------------


def check_a(config: Dict[str, Any]) -> Optional[str]:
    text = agent(config)["instructions"]["agents_md"]
    if "Run the checks manually when the suite is\nunavailable." in text:
        return "the old sentence is still there"
    if "release-qa skill" not in text:
        return "the new sentence does not mention the release-qa skill"
    # Everything else in the document survives.
    for keep in ("# Release QA agent", "Be brief.", "Always read the changelog"):
        if keep not in text:
            return f"the rewrite dropped surrounding text: {keep!r}"
    return unchanged_except(config, allowed=["instructions"])


def check_b(config: Dict[str, Any]) -> Optional[str]:
    skill = find(agent(config)["skills"], "name", "release-qa")
    if skill is None:
        return "the release-qa skill is gone"
    body = skill["body"]
    if "pytest -m smoke" in body:
        return "the old command is still there"
    if "pytest -m release" not in body:
        return "the new command 'pytest -m release' is missing"
    for keep in ("1. Pull the release branch.", "Escalate to the on-call engineer"):
        if keep not in body:
            return f"the rewrite dropped surrounding text: {keep!r}"
    if len(agent(config)["skills"]) != 3:
        return "the skills list changed length"
    other = find(agent(config)["skills"], "name", "changelog-writer")
    if other != find(agent(BASE_CONFIG)["skills"], "name", "changelog-writer"):
        return "another skill changed"
    return unchanged_except(config, allowed=["skills"])


def check_c(config: Dict[str, Any]) -> Optional[str]:
    tools = agent(config)["tools"]
    if len(tools) != 4:
        return f"expected 4 tools, found {len(tools)}"
    names = [t.get("name") or t.get("op") or t.get("slug") for t in tools]
    if "run_shell_command" not in names:
        return f"the new tool is missing; found {names}"
    for old in ("read_file", "write_file", "send-slack-message"):
        if old not in names:
            return f"the existing tool {old!r} disappeared"
    return unchanged_except(config, allowed=["tools"])


def check_d(config: Dict[str, Any]) -> Optional[str]:
    mcps = agent(config)["mcps"]
    names = [m.get("name") for m in mcps]
    if "linear" in names:
        return "the linear server is still there"
    if names != ["github"]:
        return f"expected only ['github'], found {names}"
    return unchanged_except(config, allowed=["mcps"])


def check_e(config: Dict[str, Any]) -> Optional[str]:
    skills = agent(config)["skills"]
    if len(skills) != 4:
        return f"expected 4 skills, found {len(skills)}"
    skill = find(skills, "name", "pdf-tools")
    if skill is None:
        return f"the pdf-tools skill is missing; found {[s.get('name') for s in skills]}"
    body = skill.get("body")
    if not isinstance(body, str) or "weasyprint" not in body:
        return "the skill body does not carry the SKILL.md content"
    if "$content_from" in str(skill) or "value_from" in str(skill):
        return "an unresolved content marker survived into the config"
    files = skill.get("files") or []
    ref = find(files, "path", "reference.md")
    if ref is None:
        return f"reference.md is missing; found {[f.get('path') for f in files]}"
    if "pdftk a.pdf b.pdf" not in (ref.get("content") or ""):
        return "reference.md does not carry the file content"
    return unchanged_except(config, allowed=["skills"])


def check_f(config: Dict[str, Any]) -> Optional[str]:
    """Same edit as (a), but committed on top of the moved head."""
    text = agent(config)["instructions"]["agents_md"]
    if "Escalate every production incident" not in text:
        return "the concurrent edit was lost (the model committed on the stale base)"
    if "Do not use emojis." in text:
        return "the old tone sentence is still there"
    if "Use plain language." not in text:
        return "the new tone sentence is missing"
    return unchanged_except(config, allowed=["instructions"])


def check_g(config: Dict[str, Any]) -> Optional[str]:
    body = find(agent(config)["skills"], "name", "onboarding")["body"]
    if body.count("Ask the new hire for their laptop serial number.") != 1:
        return "expected exactly one of the two duplicated sentences to survive"
    if "Ask the new hire for their GitHub username." not in body:
        return "the replacement sentence is missing"
    # The replacement must land in the second (Accounts) section, not the first.
    accounts = body.split("## Accounts", 1)
    if len(accounts) != 2:
        return "the Accounts section is gone"
    if "Ask the new hire for their GitHub username." not in accounts[1]:
        return "the edit landed in the wrong section"
    return None


def check_h(config: Dict[str, Any]) -> Optional[str]:
    return check_e(config)


# --------------------------------------------------------------------------------------
# Task (g) needs its own base: a skill body with a duplicated sentence.
# --------------------------------------------------------------------------------------

ONBOARDING_BODY = """# Onboarding

## Hardware

Ask the new hire for their laptop serial number.
Register the laptop in the asset tracker.

## Accounts

Ask the new hire for their laptop serial number.
Create the accounts in the identity provider.
"""

CONFIG_G = copy.deepcopy(BASE_CONFIG)
CONFIG_G["parameters"]["agent"]["skills"].append(
    {
        "name": "onboarding",
        "description": "Onboard a new hire.",
        "body": ONBOARDING_BODY,
        "files": [],
    }
)

# Task (f) needs a second config: the head moved between the read and the commit.
CONFIG_F_NEW_HEAD = copy.deepcopy(BASE_CONFIG)
CONFIG_F_NEW_HEAD["parameters"]["agent"]["instructions"]["agents_md"] = AGENTS_MD.replace(
    "## Tone",
    "Escalate every production incident to the on-call engineer within five minutes.\n\n## Tone",
)


def check_i(config: Dict[str, Any]) -> Optional[str]:
    skills = agent(config)["skills"]
    names = [s.get("name") for s in skills]
    if "triage" in names:
        return "the old name is still there"
    if "issue-triage" not in names:
        return f"the renamed skill is missing; found {names}"
    if len(skills) != 3:
        return f"expected 3 skills, found {len(skills)}"
    renamed = find(skills, "name", "issue-triage")
    if renamed.get("body") != "# Triage\n\nLabel the issue. Assign a priority.\n":
        return "the rename lost or rewrote the body"
    if renamed.get("description") != "Triage incoming issues.":
        return "the rename lost the description"
    return unchanged_except(config, allowed=["skills"])


def check_j(config: Dict[str, Any]) -> Optional[str]:
    skill = find(agent(config)["skills"], "name", "release-qa")
    files = skill.get("files") or []
    checklist = find(files, "path", "checklist.md")
    if checklist is None:
        return "checklist.md is gone"
    content = checklist.get("content") or ""
    if "release notes" not in content:
        return f"the new line is missing; content is {content!r}"
    if "- [ ] smoke suite" not in content or "- [ ] deploy logs" not in content:
        return f"an existing line was lost; content is {content!r}"
    if skill.get("body") != RELEASE_QA_BODY:
        return "the skill body was touched"
    return unchanged_except(config, allowed=["skills"])


def check_k(config: Dict[str, Any]) -> Optional[str]:
    a = agent(config)
    if a["llm"].get("model") != "anthropic/claude-opus-5":
        return f"the model is {a['llm'].get('model')!r}"
    if a["llm"].get("max_tokens") != 8192:
        return "max_tokens was lost: the whole llm object was replaced"
    names = [t.get("name") for t in a["tools"]]
    if "send-slack-message" in names:
        return "the slack tool is still there"
    if len(a["tools"]) != 2:
        return f"expected 2 tools, found {names}"
    text = a["instructions"]["agents_md"]
    if "Do not use emojis." in text:
        return "the emoji sentence is still there"
    if "Use plain language." not in text:
        return "the replacement sentence is missing"
    if "# Release QA agent" not in text:
        return "the instruction rewrite truncated the document"
    if a["skills"] != agent(BASE_CONFIG)["skills"]:
        return "the skills changed"
    return None


def check_l(config: Dict[str, Any]) -> Optional[str]:
    skills = agent(config)["skills"]
    skill = find(skills, "name", "deploy-helper")
    if skill is None:
        return f"the deploy-helper skill is missing; found {[s.get('name') for s in skills]}"
    if len(skills) != 4:
        return f"expected 4 skills, found {len(skills)}"
    if "@ag.file" in str(skill):
        return "an unresolved content marker survived into the config"

    files = skill.get("files") or []
    script = find(files, "path", "scripts/run.sh")
    if script is None:
        return f"scripts/run.sh is missing; found {[f.get('path') for f in files]}"
    if "curl -fsS" not in (script.get("content") or ""):
        return "scripts/run.sh does not carry the file content"

    if script.get("executable") is not True:
        return f"the file is not marked executable (executable={script.get('executable')!r})"
    if skill.get("allow_executable_files") is not True:
        return (
            "the skill does not allow executable files "
            f"(allow_executable_files={skill.get('allow_executable_files')!r})"
        )

    body = skill.get("body")
    if not isinstance(body, str) or "scripts/run.sh" not in body:
        return "the skill body does not carry the SKILL.md content"
    return unchanged_except(config, allowed=["skills"])


class Task:
    def __init__(
        self,
        tid: str,
        title: str,
        prompt: str,
        checker: Callable[[Dict[str, Any]], Optional[str]],
        *,
        config: Optional[Dict[str, Any]] = None,
        base_revision_id: str = HEAD_REVISION_ID,
        recovery: Optional[str] = None,
    ) -> None:
        self.tid = tid
        self.title = title
        self.prompt = prompt
        self.checker = checker
        self.config = config if config is not None else BASE_CONFIG
        self.base_revision_id = base_revision_id
        # "conflict" | "ambiguous" | "import_root" | None
        self.recovery = recovery


TASKS: List[Task] = [
    Task(
        "a",
        "edit one instruction sentence",
        "In your instructions, we no longer want the manual fallback. Replace the "
        "sentence that says to run the checks manually with one that says to run the "
        "release-qa skill instead. Leave the rest of the document exactly as it is.",
        check_a,
    ),
    Task(
        "b",
        "change one line in one skill body",
        "The smoke marker was renamed. In the release-qa skill, step 2 must now run "
        "`pytest -m release` instead of `pytest -m smoke`. Change only that.",
        check_b,
    ),
    Task(
        "c",
        "add one tool by name",
        "Give me a new builtin tool called run_shell_command so I can run shell "
        "commands. Keep every tool I already have.",
        check_c,
    ),
    Task(
        "d",
        "remove one MCP server",
        "We dropped Linear. Remove the linear MCP server from my configuration. Keep "
        "GitHub.",
        check_d,
    ),
    Task(
        "e",
        "add a skill from workspace files",
        "I wrote a new skill in the workspace at .agenta-imports/pdf-tools/. It has "
        "SKILL.md (the skill body) and reference.md (a bundled file). Add it as a skill "
        "named pdf-tools with the description 'Make and merge PDF files.'. Do not "
        "retype the file contents; pull them from those paths.",
        check_e,
    ),
    Task(
        "f",
        "conflict, then retry on the new head",
        "In the Tone section of my instructions, replace 'Do not use emojis.' with "
        "'Use plain language.'. Change nothing else.",
        check_f,
        recovery="conflict",
    ),
    Task(
        "g",
        "ambiguous anchor, then retry with more context",
        "In the onboarding skill, the Accounts section should ask for the GitHub "
        "username, not the laptop serial number. Fix that one line. The Hardware "
        "section must keep asking for the laptop serial number.",
        check_g,
        config=CONFIG_G,
        recovery="ambiguous",
    ),
    Task(
        "h",
        "import from the wrong folder, then correct the path",
        "Add the pdf-tools skill from my workspace folder scratch/pdf-tools/. It has "
        "SKILL.md (the skill body) and reference.md (a bundled file). Name it pdf-tools "
        "with the description 'Make and merge PDF files.'. Do not retype the file "
        "contents; pull them from those paths.",
        check_h,
        recovery="import_root",
    ),
    Task(
        "l",
        "add a skill with an executable script",
        "Add the deploy-helper skill from .agenta-imports/deploy-helper/. It has "
        "SKILL.md (the skill body) and scripts/run.sh. Its scripts/run.sh must be "
        "runnable as a program. Do not retype the file contents; pull them from those "
        "paths.",
        check_l,
    ),
    Task(
        "i",
        "rename a skill, keeping its content",
        "Rename my triage skill to issue-triage. Keep its description and its body "
        "exactly as they are.",
        check_i,
    ),
    Task(
        "j",
        "edit a line inside a bundled skill file",
        "The release-qa skill bundles a file called checklist.md. Add a third checkbox "
        "line to it for the release notes. Keep the two lines that are already there, "
        "and do not touch anything else in the skill.",
        check_j,
    ),
    Task(
        "k",
        "three changes in one commit",
        "Three things, please. Switch my model to anthropic/claude-opus-5. Drop the "
        "send-slack-message tool. And in my instructions, replace 'Do not use emojis.' "
        "with 'Use plain language.'.",
        check_k,
    ),
]

TASKS_BY_ID = {t.tid: t for t in TASKS}
