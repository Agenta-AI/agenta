"""Compatibility imports for the Vercel UI Message adapter.

New code should import from :mod:`agenta.sdk.agents.adapters.vercel`.
"""

from __future__ import annotations

from .adapters.vercel import (
    from_ui_messages,
    to_ui_message,
    ui_message_stream,
)

__all__ = [
    "from_ui_messages",
    "to_ui_message",
    "ui_message_stream",
]
