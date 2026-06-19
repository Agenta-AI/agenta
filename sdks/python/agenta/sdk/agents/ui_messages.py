"""Compatibility imports for the Vercel UI Message adapter.

New code should import from :mod:`agenta.sdk.agents.adapters.vercel`.
"""

from __future__ import annotations

from .adapters.vercel import (
    agent_run_to_vercel_parts,
    from_ui_messages,
    message_to_vercel_ui_message,
    to_ui_message,
    ui_message_stream,
    vercel_ui_messages_to_messages,
)

__all__ = [
    "vercel_ui_messages_to_messages",
    "message_to_vercel_ui_message",
    "agent_run_to_vercel_parts",
    "from_ui_messages",
    "to_ui_message",
    "ui_message_stream",
]
