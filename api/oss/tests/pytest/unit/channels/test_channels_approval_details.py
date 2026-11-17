"""The approval card in plain words: no JSON, no server mount path. Shared by
every channel, so each channel's card reads the same."""

from oss.src.core.channels.adapters.discord.mapping import (
    build_messages as discord_messages,
)
from oss.src.core.channels.adapters.slack.adapter import _card_to_markdown
from oss.src.core.channels.adapters.telegram.mapping import (
    render_content as telegram_render,
)
from oss.src.core.channels.adapters.whatsapp.mapping import _card_text
from oss.src.core.channels.render.approval import (
    approval_details,
    approval_label,
    approval_title,
    strip_mount_roots,
)

_SERVER_PATH = "/var/lib/agenta/mounts/01a1ba4c-134d/01a1c1f6-85db/note.txt"

_CARD = {
    "type": "card",
    "title": "Approval needed: Write note.txt",
    "text": "Approve allows this tool call once. Deny prevents it.",
    "tool": "Write note.txt",
    "arguments": {"content": "hi", "file_path": _SERVER_PATH},
}


def test_a_write_reads_as_plain_lines_with_the_mount_path_removed():
    assert approval_details(_CARD["arguments"]) == "Content: hi\nFile path: note.txt"


def test_every_mount_root_form_is_removed():
    assert strip_mount_roots("/var/lib/agenta/mounts/s/m/notes/a.md") == "notes/a.md"
    assert (
        strip_mount_roots("/home/sandbox/agenta/mounts/s/m-agent/plan.md") == "plan.md"
    )
    # the optional per-deployment namespace
    assert strip_mount_roots("/home/sandbox/agenta/ns/mounts/s/m/x.csv") == "x.csv"
    assert (
        strip_mount_roots("cat '/var/lib/agenta/mounts/s/m/a b.md'") == "cat 'a b.md'"
    )
    # a path outside a mount names what the call touches, so it stays
    assert strip_mount_roots("/etc/hosts") == "/etc/hosts"
    assert strip_mount_roots("/data/mounts/a/b/c") == "/data/mounts/a/b/c"


_MOUNT_ROOT = "/home/sandbox/agenta/mounts/0190aaaa-bbbb/0190cccc-dddd"


def test_a_command_on_the_mount_root_still_shows_its_target():
    assert approval_details({"command": f"rm -rf {_MOUNT_ROOT}"}) == (
        "Command: rm -rf ."
    )
    assert approval_details({"command": f"rm -rf {_MOUNT_ROOT}/"}) == (
        "Command: rm -rf ."
    )


def test_a_path_that_is_the_mount_root_reads_as_dot():
    assert approval_details({"path": _MOUNT_ROOT}) == "Path: ."


def test_a_mount_root_inside_a_command_reads_as_dot():
    assert approval_details({"command": f"cd {_MOUNT_ROOT} && rm -rf *"}) == (
        "Command: cd . && rm -rf *"
    )
    assert strip_mount_roots(f"cd '{_MOUNT_ROOT}'") == "cd '.'"


def test_a_title_on_the_mount_root_still_shows_its_target():
    assert approval_title(f"rm -rf {_MOUNT_ROOT}") == "Approval needed: rm -rf ."


def test_a_harness_title_with_a_server_path_shows_the_mount_path():
    assert approval_label(f"Write {_SERVER_PATH}") == "Write note.txt"


def test_nested_lists_and_flags_read_as_words():
    text = approval_details(
        {
            "command": "ls -la",
            "dryRun": False,
            "tags": ["a", "b"],
            "options": {"depth": 2, "unused": None},
            "empty": "",
        }
    )
    assert text == (
        "Command: ls -la\nDry run: no\nTags: a, b\nOptions:\n  Depth: 2\n"
        "  Unused: (empty)\nEmpty: (empty)"
    )
    assert "{" not in text and '"' not in text


def test_secrets_stay_redacted():
    text = approval_details({"api_key": "private-value", "query": "x"})
    assert "private-value" not in text
    assert "Api key: [REDACTED]" in text


def test_no_arguments_add_no_line():
    assert approval_details({}) == ""
    assert "Arguments unavailable" in approval_details(None)


def test_a_long_body_is_cut_with_a_pointer_to_agenta():
    text = approval_details({"content": "/a" * 50_000})
    assert len(text) < 700
    assert text.endswith("[Truncated. Review the full request in Agenta.]")


def _assert_plain(text):
    assert "File path: note.txt" in text
    assert "Content: hi" in text
    assert "/var/lib/agenta" not in text
    assert '"file_path"' not in text
    assert "Arguments:" not in text


def test_every_channel_shows_the_plain_card():
    _assert_plain(_card_to_markdown(_CARD))
    _assert_plain(telegram_render([_CARD])[0])
    _assert_plain(_card_text(_CARD))
    _assert_plain(discord_messages([_CARD])[0]["content"])


def test_a_card_without_arguments_ends_with_its_scope_line():
    card = {**_CARD, "arguments": {}}
    assert _card_text(card).endswith("Deny prevents it.")
    assert discord_messages([card])[0]["content"].endswith("Deny prevents it.")


def test_an_empty_value_is_shown_because_it_changes_what_the_call_does():
    # writing empty content erases the file
    assert approval_details({"file_path": "note.txt", "content": ""}) == (
        "File path: note.txt\nContent: (empty)"
    )


def test_a_value_cut_before_display_always_carries_the_truncation_note():
    text = approval_details({"command": "echo ok" + " " * 1200 + "; rm important.txt"})
    assert text.startswith("Command: echo ok")
    assert text.endswith("[Truncated. Review the full request in Agenta.]")


def test_arguments_nested_too_deep_carry_the_truncation_note():
    text = approval_details({"a": {"b": {"c": {"d": {"e": 1}}}}})
    assert "E: 1" not in text
    assert text.endswith("[Truncated. Review the full request in Agenta.]")
