"""Deny-set seeding: known-value redaction only ever registers VALUES, never key names.

Sources per request/run:
  1. resolved connection/tool/mcp secrets (``ResolvedConnection.env``, ``ResolvedMCPServer.env``,
     tool-spec secrets) — the values the platform just resolved for this run;
  2. the request/run credential (the caller's Agenta API key);
  3. the VALUE of any process env var selected by the name matchers below.

Selection model (each has a ``DEFAULT_*`` constant; each env var MERGES with — concatenates onto —
its default, never replaces):
  - PREFIX  (``AGENTA_REDACTED_PREFIXES``) — name starts with a service prefix. Default EMPTY:
    opt-in only, because a broad service prefix over-seeds non-secret config (hostnames, regions,
    paths). Off by default; suffix + blocklist carry the baseline.
  - SUFFIX  (``AGENTA_REDACTED_SUFFIXES``) — name ends in a credential suffix.
  - BLOCKLIST (``AGENTA_REDACTED_BLOCKLIST``) — name equals/contains an entry.
  These three are NAME matchers → their VALUES seed. BLOCKLIST is names, never values (a value in an
  env var would itself be a plaintext-secret leak).
  - ALLOWLIST (``AGENTA_REDACTED_ALLOWLIST``) — literal VALUES never redacted (booleans/flags),
    applied in ``Redactor.with_known_secrets``.

Names are lookup keys only; nothing here redacts by name. The api/services side reads the same env
vars through ``env.agenta.redaction`` in ``api/oss/src/utils/env.py``.
"""

from __future__ import annotations

import os
from typing import Iterable, List, Optional

from .redactor import DEFAULT_REDACTION_ALLOWLIST, Redactor

# Service/vendor name prefixes: any env var under a matched provider seeds its value. Default EMPTY
# (opt-in via AGENTA_REDACTED_PREFIXES) — a broad prefix over-seeds non-secret config; suffix carries
# the baseline. Ready-to-use candidates for operators: OPENAI_, ANTHROPIC_, AWS_, STRIPE_, GOOGLE_, ...
DEFAULT_REDACTED_PREFIXES: tuple = ()

# A name ending in one of these looks like a secret value.
DEFAULT_REDACTED_SUFFIXES: tuple = (
    "_KEY",
    "_SECRET",
    "_TOKEN",
    "_AUTHTOKEN",
    "_PASSWORD",
    "_CREDENTIALS",
    "_KEY_ID",
    "_SECRET_ID",
    "_TOKEN_ID",
)

# Env NAMES to force-seed (equals/contains) — the escape hatch for a real secret whose name matches
# no suffix. AWS_BEARER_TOKEN_BEDROCK is the one such catalog secret.
DEFAULT_REDACTED_BLOCKLIST: tuple = ("AWS_BEARER_TOKEN_BEDROCK",)


def _csv_override(name: str) -> tuple:
    """Parse a comma-separated env var to an upper-cased tuple; empty if unset. Read directly via
    os.getenv — the SDK has no shared ``env`` object (that convention is scoped to api/ code)."""
    raw = os.getenv(name) or ""
    return tuple(item.strip().upper() for item in raw.split(",") if item.strip())


def _merged(default: tuple, env_name: str) -> tuple:
    """Default CONCATENATED with the operator's env entries (merge, never replace) — dedup, keep
    order (defaults first)."""
    seen = set()
    out = []
    for item in (*default, *_csv_override(env_name)):
        if item not in seen:
            seen.add(item)
            out.append(item)
    return tuple(out)


def _effective_prefixes() -> tuple:
    return _merged(DEFAULT_REDACTED_PREFIXES, "AGENTA_REDACTED_PREFIXES")


def _effective_suffixes() -> tuple:
    return _merged(DEFAULT_REDACTED_SUFFIXES, "AGENTA_REDACTED_SUFFIXES")


def _effective_blocklist() -> tuple:
    return _merged(DEFAULT_REDACTED_BLOCKLIST, "AGENTA_REDACTED_BLOCKLIST")


def _effective_allowlist() -> frozenset:
    """Default allowlist UNION operator additions (merge, never replace)."""
    return DEFAULT_REDACTION_ALLOWLIST | frozenset(
        v.lower() for v in _csv_override("AGENTA_REDACTED_ALLOWLIST")
    )


def _looks_secret(name: str) -> bool:
    if name.startswith(_effective_prefixes()):
        return True
    if name.endswith(_effective_suffixes()):
        return True
    blocklist = _effective_blocklist()
    return bool(blocklist) and any(b in name for b in blocklist)


def curated_env_secret_values() -> List[str]:
    """The VALUES (never the names) of every env var whose name is selected by the matchers."""
    values: List[str] = []
    for name, value in os.environ.items():
        if value and _looks_secret(name.upper()):
            values.append(value)
    return values


def seed_from_request(
    *,
    resolved_envs: Optional[Iterable[dict]] = None,
    request_credential: Optional[str] = None,
    extra_values: Optional[Iterable[Optional[str]]] = None,
    redactor: Optional[Redactor] = None,
) -> Redactor:
    """Build (or extend) a per-request deny-set from resolved secrets + the request credential +
    the selected env vars' values. Never seeds by key name; allowlisted values are dropped."""
    r = redactor or Redactor(allowlist=_effective_allowlist())
    values: List[str] = []
    for env in resolved_envs or []:
        if isinstance(env, dict):
            values.extend(v for v in env.values() if isinstance(v, str))
    if request_credential:
        values.append(request_credential)
    values.extend(v for v in (extra_values or []) if v)
    values.extend(curated_env_secret_values())
    return r.with_known_secrets(values)
