from typing import Any, Dict, Optional


class SessionInputError(Exception):
    pass


class SessionInputBusy(SessionInputError):
    def __init__(self, current_execution_id: Optional[str] = None):
        self.current_execution_id = current_execution_id
        super().__init__("The session is already running an execution.")


class SessionInputNotFound(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__("The pending input was not found.")


class SessionInputNotRemovable(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__("The input can no longer be removed because it was promoted.")


class SessionInputIdempotencyConflict(SessionInputError):
    def __init__(self):
        super().__init__("This idempotency key was already used for a different input.")


class SessionInputRemoved(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__("The queued input was removed and cannot be sent.")


class SessionInputNotEditable(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__(
            "The queued input is no longer editable because it was removed, promoted, or selected to run next."
        )


class SessionInputContentInvalid(SessionInputError):
    pass


# Every key that server code builds for a session input starts with this namespace. A
# client key with it is refused, so a client never takes a server key first in a session
# it can also write to. The prefix only reserves keys: rules read `kind`, never the key.
RESERVED_KEY_PREFIX = "ag:"


def is_reserved_input_key(key: Optional[str]) -> bool:
    return bool(key) and key.startswith(RESERVED_KEY_PREFIX)


class SessionInputKeyReserved(SessionInputError):
    def __init__(self):
        super().__init__(
            f"Idempotency keys that start with '{RESERVED_KEY_PREFIX}' are reserved."
        )


# Vercel UI tool-part states that hold a person's approval answer inline.
_ANSWERED_TOOL_PART_STATES = frozenset({"approval-responded", "output-denied"})


def _has_approved_flag(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("approved"), bool)


def _is_approval_answer(block: Dict[str, Any]) -> bool:
    kind = block.get("type")
    if kind == "tool_result":
        return _has_approved_flag(block.get("output"))
    if kind == "tool-approval-response":
        return True
    if isinstance(kind, str) and (kind.startswith("tool-") or kind == "dynamic-tool"):
        # The SDK turns a tool part's `output` into a `tool_result` in every state.
        state = block.get("state")
        return (
            (isinstance(state, str) and state in _ANSWERED_TOOL_PART_STATES)
            or _has_approved_flag(block.get("approval"))
            or _has_approved_flag(block.get("output"))
        )
    return False


def carries_approval_answer(content: Any) -> bool:
    """True when `content` holds a block that the runner reads as an approval answer
    anywhere inside it: a `tool_result` whose `output` has a boolean `approved`, a
    `tool-approval-response` part, or a tool part answered inline
    (`approval-responded`, `output-denied`, `approval.approved`) or whose `output` has
    a boolean `approved`. Approval answers
    come only from a person through the approval routes, never from server code."""
    if isinstance(content, dict):
        return _is_approval_answer(content) or any(
            carries_approval_answer(value) for value in content.values()
        )
    if isinstance(content, list):
        return any(carries_approval_answer(item) for item in content)
    return False


class SessionInputCarriesApprovalAnswer(SessionInputError):
    def __init__(self):
        super().__init__("A server input cannot carry an approval answer.")


class SessionInputEditRefused(SessionInputError):
    """Only the sender of a queued message may edit it, and nobody may edit a server
    input. `reason`: `server_input` or `not_sender`."""

    def __init__(self, input_id: str, reason: str):
        self.input_id = input_id
        self.reason = reason
        super().__init__(
            "Only the person who sent this queued message can edit it."
            if reason == "not_sender"
            else "This queued input was written by the server and cannot be edited."
        )


class SessionInputEnvelopeMismatch(SessionInputError):
    def __init__(self):
        super().__init__("The run envelope belongs to another project.")
