"""Facts about the Pi harness itself, independent of any Agenta opinion.

``PI_DEFAULT_ACTIVE_BUILTINS`` is Pi's OWN default active built-in set: what Pi turns on when
nobody tells it otherwise. It is deliberately not in :mod:`.adapters.agenta_builtins`, which
holds the ``pi_agenta`` harness's forced Agenta opinions (``AGENTA_FORCED_TOOLS`` and friends).

The TypeScript side holds the same list under the same name
(``services/runner/src/engines/sandbox_agent/run-plan.ts``). Neither language owns it: both are
pinned against the shared golden fixture
``sdks/python/oss/tests/pytest/unit/agents/golden/pi_default_active_builtins.json``.
"""

from __future__ import annotations

from typing import Tuple

PI_DEFAULT_ACTIVE_BUILTINS: Tuple[str, ...] = ("read", "bash", "edit", "write")
