import json
import re
from typing import Any

_SECRET_KEY = re.compile(
    r"(?:^|_)(?:password|passwd|secret|token|api_key|authorization|cookie|private_key)(?:$|_)",
    re.IGNORECASE,
)


def redact_approval_arguments(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]"
            if _SECRET_KEY.search(str(key))
            else redact_approval_arguments(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_approval_arguments(item) for item in value]
    return value


def approval_details(arguments: Any) -> str:
    if not isinstance(arguments, dict):
        return "Arguments unavailable. Review this request in Agenta before approving."
    text = json.dumps(
        redact_approval_arguments(arguments), ensure_ascii=False, indent=2, default=str
    )
    # Reserve room for HTML escaping and the title within provider message limits.
    if len(text) > 600:
        text = text[:600] + "\n[Truncated. Review the full request in Agenta.]"
    return f"Arguments:\n{text}"
