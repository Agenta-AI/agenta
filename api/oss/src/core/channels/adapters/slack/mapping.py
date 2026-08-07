import re
from typing import Any, Dict, List, Optional, Tuple

from oss.src.core.channels.dtos import ChannelSpaceKind

# Slack rewrites @mention into <@U…> before delivery (channels.md §3 "Addressing")
# so the adapter parses ~agent/!command from otherwise-untouched text, never @.
_AGENT_SIGIL_RE = re.compile(r"(?<!\S)~(?P<agent>[\w.-]+)")
_COMMAND_SIGIL_RE = re.compile(r"(?<!\S)!(?P<command>[\w-]+)(?::(?P<arg>\S+))?")

MAX_CHARS = 4000
BUTTONS_MAX = 5


def classify_space_kind(event: Dict[str, Any]) -> ChannelSpaceKind:
    """is_im -> private, is_mpim -> group, private/public channel -> topic (D8)."""

    if event.get("channel_type") == "im" or event.get("is_im"):
        return ChannelSpaceKind.PRIVATE
    if event.get("channel_type") == "mpim" or event.get("is_mpim"):
        return ChannelSpaceKind.GROUP
    return ChannelSpaceKind.TOPIC


def extract_sigils(text: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """(~agent, !command, arg) — independent, either or both may be absent."""

    agent_match = _AGENT_SIGIL_RE.search(text)
    command_match = _COMMAND_SIGIL_RE.search(text)

    agent = agent_match.group("agent") if agent_match else None
    command = command_match.group("command") if command_match else None
    arg = command_match.group("arg") if command_match else None

    return agent, command, arg


def build_locator(
    *, team: str, channel: str, thread_ts: Optional[str] = None
) -> Dict[str, Any]:
    """team/channel always; thread_ts only when present — thread_ts absent means
    the space unit, never a locator with a null field (D-thread-is-not-a-container)."""

    locator: Dict[str, Any] = {"team": team, "channel": channel}
    if thread_ts:
        locator["thread_ts"] = thread_ts
    return locator


def is_bot_authored(event: Dict[str, Any], *, bot_user_id: Optional[str]) -> bool:
    """The domain must never treat the adapter's own posts as input (D23)."""

    if event.get("bot_id"):
        return True
    if bot_user_id and event.get("user") == bot_user_id:
        return True
    return False


def format_attribution(display_name: str, text: str) -> str:
    """Speaker attribution as formatting only — never a `sender` field (D11)."""

    return f"*{display_name}:* {text}"


def split_for_max_chars(text: str, *, max_chars: int = MAX_CHARS) -> List[str]:
    """Split rather than truncate (specs-wp6.md Outbound mapping)."""

    if len(text) <= max_chars:
        return [text]

    parts = []
    remaining = text
    while remaining:
        parts.append(remaining[:max_chars])
        remaining = remaining[max_chars:]
    return parts


def render_buttons_or_degrade(
    options: List[Dict[str, Any]], *, buttons_max: int = BUTTONS_MAX
) -> Dict[str, Any]:
    """<= buttons_max renders as Block Kit buttons; above degrades to numbered
    text (specs-wp6.md "an approval with 6+ options degrades")."""

    if len(options) <= buttons_max:
        return {
            "type": "buttons",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": option["label"]},
                    "value": option["value"],
                }
                for option in options
            ],
        }

    lines = [f"{i + 1}. {option['label']}" for i, option in enumerate(options)]
    return {
        "type": "text",
        "text": "\n".join(lines),
    }


def render_approval_card(tool_call: Dict[str, Any]) -> Dict[str, Any]:
    """Sourced only from the recorded tool call, never model-composed text
    (architecture.md §6.3)."""

    name = tool_call["name"]
    arguments = tool_call.get("arguments", {})
    lines = [f"*Approval requested:* `{name}`"]
    for key, value in arguments.items():
        lines.append(f"- {key}: {value}")
    return {"type": "text", "text": "\n".join(lines)}
