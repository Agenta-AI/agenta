"""The known-value redaction pass, mirrored TS-side in ``services/runner/src/redaction.ts``.

Slice 1 (docs/designs/online-redaction): exact-match against a per-request/run deny-set of
known live secrets, wired at every sink (errors, records, spans, logs). Shape/entropy passes
(Slice 2) are declared as no-op extension points (`_shape_pass` / `_entropy_pass`) so activating
them later is a wiring change, not a redesign.

Fail-safe: any exception during redaction returns the placeholder, never the raw string.
"""

from __future__ import annotations

import base64
import os
import re
import warnings
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from agenta.sdk.redaction import metrics

_PLACEHOLDER_BARE = "[ag:redacted]"
_LIVE_MODES = {"off", "known"}
_INERT_MODES = {"pattern", "full"}


def redaction_mode() -> str:
    """`AGENTA_REDACTION_MODE`: only `off`/`known` are live in Slice 1; `pattern`/`full` are
    declared-but-inert and behave as `known` with a warning (mirrors api/oss/src/utils/env.py's
    `RedactionConfig` for services that don't route through the shared `env` object)."""
    mode = (os.getenv("AGENTA_REDACTION_MODE") or "known").strip().lower()
    if mode in _INERT_MODES:
        warnings.warn(
            f"AGENTA_REDACTION_MODE={mode} is declared but inert (Slice 2 not shipped); behaving as 'known'.",
            stacklevel=2,
        )
        return "known"
    if mode not in _LIVE_MODES:
        warnings.warn(
            f"AGENTA_REDACTION_MODE={mode!r} is not recognized; behaving as 'known'.",
            stacklevel=2,
        )
        return "known"
    return mode


_STACK_FRAME_RE = re.compile(r"\bat\s+\S+\s*\(|\bFile\s+\"|/[\w./-]+:\d+")

# Values never redacted even if a secret-named env var holds them: booleans/flags/common tokens
# would poison the deny-set (redacting every "true"/"1" in output). Operators extend, never shrink.
DEFAULT_REDACTION_ALLOWLIST = frozenset(
    {
        "true",
        "false",
        "none",
        "null",
        "nil",
        "yes",
        "no",
        "on",
        "off",
        "enabled",
        "disabled",
        "0",
        "1",
        "-1",
        "",
    }
)


def _placeholder(kind: str, value: str) -> str:
    last4 = value[-4:] if len(value) >= 4 else value
    return f"[ag:redacted:{kind}:{last4}]"


def _variants(value: str) -> List[str]:
    """The raw value plus its common encodings, so a value redacts even when echoed encoded."""
    out = [value]
    try:
        out.append(quote(value, safe=""))
    except Exception:
        pass
    try:
        out.append(base64.b64encode(value.encode("utf-8")).decode("ascii"))
    except Exception:
        pass
    return out


_DSN_USERINFO_RE = re.compile(r"^[a-zA-Z][\w+.-]*://([^:/@\s]+):([^@/\s]+)@")
_BASIC_AUTH_RE = re.compile(r"^([^:\s]+):([^:\s]+)$")


def _decompose(value: str) -> List[str]:
    """Parts of a compound credential worth registering individually: the DSN userinfo
    (`scheme://user:pass@`) or a bare `user:pass` pair — register both halves."""
    match = _DSN_USERINFO_RE.match(value) or _BASIC_AUTH_RE.match(value)
    if not match:
        return []
    return [part for part in match.groups() if part]


class Redactor:
    """Known-value redaction: exact-match against a deny-set of live secrets.

    ``with_known_secrets`` seeds the deny-set; ``redact_string`` / ``redact_json`` /
    ``redact_error`` apply it. Zero false positives — a value is only ever redacted if the
    caller told us it's a live secret.
    """

    def __init__(self, *, allowlist: Optional[frozenset] = None) -> None:
        # Effective allowlist = default UNION operator additions (merge, never replace): a safety
        # guard, so extending it can only spare more, never start redacting booleans.
        self._allowlist = DEFAULT_REDACTION_ALLOWLIST | (allowlist or frozenset())
        self._known: Dict[str, str] = {}  # variant -> kind
        # Decomposed compound-credential parts (e.g. the DSN password half) need word-boundary
        # matching so a short part can't clip inside an unrelated word in user content; the full
        # value/encoding variants are high-entropy enough to substring-match safely.
        self._bounded: set = set()
        self._sorted_values: List[str] = []  # longest-first, recomputed on seed

    def with_known_secrets(
        self,
        values: List[Optional[str]],
        *,
        kind: str = "secret",
    ) -> "Redactor":
        """Register live secret values (and their variants/parts) for exact-match redaction."""
        for value in values:
            if not value or not isinstance(value, str):
                continue
            if value.strip().lower() in self._allowlist:
                continue  # worthless/common value — would poison the deny-set, not a real secret
            for variant in _variants(value):
                if variant and len(variant) >= 4:
                    self._known.setdefault(variant, kind)
            # Decomposed parts are shorter and more collision-prone, so require more length
            # and match only on a word boundary (never mid-token in unrelated content).
            for part in _decompose(value):
                if part and len(part) >= 8:
                    self._known.setdefault(part, kind)
                    self._bounded.add(part)
        self._sorted_values = sorted(self._known.keys(), key=len, reverse=True)
        return self

    def redact_string(
        self, value: Optional[str], *, sink: str = "unknown"
    ) -> Optional[str]:
        if value is None:
            return None
        try:
            return self._known_value_pass(value, sink=sink)
        except Exception:  # fail-safe: never leak the raw string on error
            return _PLACEHOLDER_BARE

    def _known_value_pass(self, value: str, *, sink: str) -> str:
        if redaction_mode() == "off" or not self._sorted_values or not value:
            return self._shape_pass(value, sink=sink)

        out = value
        for variant in self._sorted_values:
            kind = self._known[variant]
            if variant in self._bounded:
                pattern = re.compile(r"(?<!\w)" + re.escape(variant) + r"(?!\w)")
                if pattern.search(out):
                    out = pattern.sub(_placeholder(kind, variant), out)
                    metrics.increment(sink, kind)
            elif variant in out:
                out = out.replace(variant, _placeholder(kind, variant))
                metrics.increment(sink, kind)
        return self._shape_pass(out, sink=sink)

    def redact_json(self, obj: Any, *, sink: str = "unknown") -> Any:
        try:
            return self._redact_json_inner(obj, sink=sink)
        except (
            Exception
        ):  # fail-safe: never leak the raw value, but keep the caller's shape
            if isinstance(obj, dict):
                return {}
            if isinstance(obj, list):
                return []
            return _PLACEHOLDER_BARE

    def _redact_json_inner(self, obj: Any, *, sink: str) -> Any:
        if isinstance(obj, str):
            return self._known_value_pass(obj, sink=sink)
        if isinstance(obj, dict):
            return {
                key: self._redact_json_inner(value, sink=sink)
                for key, value in obj.items()
            }
        if isinstance(obj, list):
            return [self._redact_json_inner(item, sink=sink) for item in obj]
        if isinstance(obj, tuple):
            return tuple(self._redact_json_inner(item, sink=sink) for item in obj)
        return obj

    def redact_error(self, error: Any, *, sink: str = "error") -> str:
        """Strip stack-frame noise, then run the known-value pass on what remains."""
        try:
            raw = "" if error is None else str(error)
            message = raw.split("\n", 1)[0].strip()
            if not message or _STACK_FRAME_RE.match(message):
                message = "agent run failed"
            return self._known_value_pass(message, sink=sink)
        except Exception:  # fail-safe
            return _PLACEHOLDER_BARE

    # --- Slice 2 extension points (shape/entropy passes). No-ops until the §7.1 opt-in ships. ---

    def _shape_pass(self, value: str, *, sink: str) -> str:  # pylint: disable=unused-argument
        """Credential-shape + token-shape passes (Slice 2). No-op in Slice 1."""
        return value

    def _entropy_pass(self, value: str, *, sink: str) -> str:  # pylint: disable=unused-argument
        """Entropy pass (Slice 2). No-op in Slice 1."""
        return value
