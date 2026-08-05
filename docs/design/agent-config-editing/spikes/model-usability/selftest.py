# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Prove every task is solvable: hand-written golden deltas must pass their checkers.

It also proves the negative cases fire: (f) must 409 on the stale base, (g) must give
text_not_unique on the short anchor, (h) must refuse the scratch/ path.
"""

import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

import harness  # noqa: E402
import tasks as T  # noqa: E402

AGENT = ["parameters", "agent"]

GOLDEN = {
    "a": {
        "operations": [
            {
                "operation": "edit_text",
                "target": AGENT + ["instructions", "agents_md"],
                "edits": [
                    {
                        "old_text": "Run the checks manually when the suite is\nunavailable.",
                        "new_text": "Run the release-qa skill instead.",
                    }
                ],
            }
        ]
    },
    "b": {
        "operations": [
            {
                "operation": "edit_text",
                "target": AGENT + [{"field": "skills", "key": "release-qa"}, "body"],
                "edits": [
                    {
                        "old_text": "pytest -m smoke",
                        "new_text": "pytest -m release",
                    }
                ],
            }
        ]
    },
    "c": {
        "operations": [
            {
                "operation": "add_item",
                "target": AGENT + ["tools"],
                "value": {"type": "builtin", "name": "run_shell_command"},
            }
        ]
    },
    "d": {
        "operations": [
            {
                "operation": "remove_item",
                "target": AGENT + [{"field": "mcps", "key": "linear"}],
            }
        ]
    },
    "e": {
        "operations": [
            {
                "operation": "add_item",
                "target": AGENT + ["skills"],
                "value": {
                    "name": "pdf-tools",
                    "description": "Make and merge PDF files.",
                    "body": {"$content_from": ".agenta-imports/pdf-tools/SKILL.md"},
                    "files": [
                        {
                            "path": "reference.md",
                            "content": {
                                "$content_from": ".agenta-imports/pdf-tools/reference.md"
                            },
                        }
                    ],
                },
            }
        ]
    },
    "f": {
        "operations": [
            {
                "operation": "edit_text",
                "target": AGENT + ["instructions", "agents_md"],
                "edits": [
                    {"old_text": "Do not use emojis.", "new_text": "Use plain language."}
                ],
            }
        ]
    },
    "g": {
        "operations": [
            {
                "operation": "edit_text",
                "target": AGENT + [{"field": "skills", "key": "onboarding"}, "body"],
                "edits": [
                    {
                        "old_text": "Ask the new hire for their laptop serial number.\nCreate the accounts",
                        "new_text": "Ask the new hire for their GitHub username.\nCreate the accounts",
                    }
                ],
            }
        ]
    },
    "h": {
        "operations": [
            {
                "operation": "add_item",
                "target": AGENT + ["skills"],
                "value": {
                    "name": "pdf-tools",
                    "description": "Make and merge PDF files.",
                    "body": {"$content_from": ".agenta-imports/pdf-tools/SKILL.md"},
                    "files": [
                        {
                            "path": "reference.md",
                            "content": {
                                "$content_from": ".agenta-imports/pdf-tools/reference.md"
                            },
                        }
                    ],
                },
            }
        ]
    },
    "l": {
        "operations": [
            {
                "operation": "add_item",
                "target": AGENT + ["skills"],
                "value": {
                    "name": "deploy-helper",
                    "description": "Deploy the service.",
                    "allow_executable_files": True,
                    "body": {"@ag.file": ".agenta-imports/deploy-helper/SKILL.md"},
                    "files": [
                        {
                            "path": "scripts/run.sh",
                            "content": {
                                "@ag.file": ".agenta-imports/deploy-helper/scripts/run.sh"
                            },
                            "executable": True,
                        }
                    ],
                },
            }
        ]
    },
    "i": {
        "operations": [
            {
                "operation": "remove_item",
                "target": AGENT + [{"field": "skills", "key": "triage"}],
            },
            {
                "operation": "add_item",
                "target": AGENT + ["skills"],
                "value": {
                    "name": "issue-triage",
                    "description": "Triage incoming issues.",
                    "body": "# Triage\n\nLabel the issue. Assign a priority.\n",
                    "allow_executable_files": False,
                    "files": [],
                },
            },
        ]
    },
    "j": {
        "operations": [
            {
                "operation": "edit_text",
                "target": AGENT
                + [
                    {"field": "skills", "key": "release-qa"},
                    {"field": "files", "key": "checklist.md"},
                    "content",
                ],
                "edits": [
                    {
                        "old_text": "- [ ] deploy logs\n",
                        "new_text": "- [ ] deploy logs\n- [ ] release notes\n",
                    }
                ],
            }
        ]
    },
    "k": {
        "operations": [
            {
                "operation": "set",
                "target": AGENT + ["llm", "model"],
                "value": "anthropic/claude-opus-5",
            },
            {
                "operation": "remove_item",
                "target": AGENT + [{"field": "tools", "key": "send-slack-message"}],
            },
            {
                "operation": "edit_text",
                "target": AGENT + ["instructions", "agents_md"],
                "edits": [
                    {"old_text": "Do not use emojis.", "new_text": "Use plain language."}
                ],
            },
        ]
    },
}


def head_for(task):
    if task.recovery == "conflict":
        return T.CONFIG_F_NEW_HEAD, T.NEW_HEAD_REVISION_ID
    return task.config, task.base_revision_id


failures = []

for task in T.TASKS:
    head_config, head_revision_id = head_for(task)
    envelope = {
        "workflow_revision": {
            "base_revision_id": head_revision_id,
            "message": "test",
            "delta": GOLDEN[task.tid],
        }
    }
    config, payload = harness.run_commit(
        envelope, head_config=head_config, head_revision_id=head_revision_id
    )
    if config is None:
        failures.append(f"{task.tid}: engine refused the golden delta: {payload}")
        continue
    problem = task.checker(config)
    if problem:
        failures.append(f"{task.tid}: checker rejected the golden result: {problem}")
    else:
        print(f"golden {task.tid}: ok")

# --- the negative cases must fire ---

stale = {
    "workflow_revision": {
        "base_revision_id": T.HEAD_REVISION_ID,
        "message": "test",
        "delta": GOLDEN["f"],
    }
}
config, payload = harness.run_commit(
    stale, head_config=T.CONFIG_F_NEW_HEAD, head_revision_id=T.NEW_HEAD_REVISION_ID
)
if config is not None or payload["error"]["code"] != "stale_base_revision":
    failures.append(f"f: the stale base did not 409: {payload}")
else:
    print("negative f: stale base 409 ok")

short = {
    "workflow_revision": {
        "base_revision_id": T.HEAD_REVISION_ID,
        "message": "test",
        "delta": {
            "operations": [
                {
                    "operation": "edit_text",
                    "target": AGENT + [{"field": "skills", "key": "onboarding"}, "body"],
                    "edits": [
                        {
                            "old_text": "Ask the new hire for their laptop serial number.",
                            "new_text": "Ask the new hire for their GitHub username.",
                        }
                    ],
                }
            ]
        },
    }
}
config, payload = harness.run_commit(
    short, head_config=T.CONFIG_G, head_revision_id=T.HEAD_REVISION_ID
)
if config is not None or payload["error"]["reason"]["code"] != "text_not_unique":
    failures.append(f"g: the ambiguous anchor did not fire: {payload}")
else:
    print(
        f"negative g: text_not_unique ok "
        f"(match_count={payload['error']['reason'].get('match_count')})"
    )

wrong_folder = {
    "workflow_revision": {
        "base_revision_id": T.HEAD_REVISION_ID,
        "message": "test",
        "delta": {
            "operations": [
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "name": "pdf-tools",
                        "description": "Make and merge PDF files.",
                        "body": {"$content_from": "scratch/pdf-tools/SKILL.md"},
                    },
                }
            ]
        },
    }
}
config, payload = harness.run_commit(
    wrong_folder, head_config=T.BASE_CONFIG, head_revision_id=T.HEAD_REVISION_ID
)
if config is not None or payload["error"]["reason"]["code"] != "source_outside_import_root":
    failures.append(f"h: the wrong folder was not refused: {payload}")
else:
    print("negative h: source_outside_import_root ok")
    print("   hint given:", payload["error"]["reason"]["folders_under_import_root"])

# --- a wholesale set of the instructions must NOT pass check_a ---
wholesale = {
    "workflow_revision": {
        "base_revision_id": T.HEAD_REVISION_ID,
        "message": "test",
        "delta": {
            "operations": [
                {
                    "operation": "set",
                    "target": AGENT + ["instructions", "agents_md"],
                    "value": "Run the release-qa skill instead.",
                }
            ]
        },
    }
}
config, payload = harness.run_commit(
    wholesale, head_config=T.BASE_CONFIG, head_revision_id=T.HEAD_REVISION_ID
)
if config is None or T.check_a(config) is None:
    failures.append("a: a truncating wholesale set was accepted by the checker")
else:
    print("negative a: truncating set rejected by the checker")

print()
if failures:
    for failure in failures:
        print("FAIL:", failure)
    sys.exit(1)
print("all task fixtures are solvable and every negative case fires")
