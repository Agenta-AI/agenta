"""Deployment flags the agent surface reads at import.

One definition, because two readers of the same switch is how a model ends up seeing two
shapes at once. The op catalog decides which commit surface to advertise from
:func:`ordered_operations_enabled`, and the ``build-an-agent`` skill decides which commit
surface to TEACH from the same call. A live agent once followed the skill's example over the
tool description and replaced a list it meant to append to; that is only possible when the two
can disagree.

This module imports nothing but ``os`` on purpose. ``agenta.sdk.agents.platform`` is kept out
of the eager import path (it reaches the SDK singleton), so an adapter cannot import the
catalog just to read a flag.
"""

from __future__ import annotations

import os

__all__ = ["ORDERED_OPERATIONS_ENV", "ordered_operations_enabled"]

# Gate for the ordered-operations commit surface: `read_config` plus `delta.operations`.
ORDERED_OPERATIONS_ENV = "AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED"

# Mirrors `_TRUTHY` in `api/oss/src/utils/env.py`, which the SDK cannot import: that module
# is the API's foundational config and pulls the whole API package in behind it. The two
# sets must accept the same spellings, or a deployment written as `enabled` turns the
# ordered arm on in the API while the catalog keeps advertising the legacy surface. The
# equality is pinned by `api/oss/tests/pytest/unit/workflows/test_ordered_operations_flag.py`,
# which is on the one side that can import both.
_TRUTHY = frozenset({"true", "1", "t", "y", "yes", "on", "enable", "enabled"})


def ordered_operations_enabled() -> bool:
    return (os.getenv(ORDERED_OPERATIONS_ENV) or "").strip().lower() in _TRUTHY
