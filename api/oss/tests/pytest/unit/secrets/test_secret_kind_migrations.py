"""Every `SecretKind` the code writes exists on the database enum after a migration run.

`secrets.kind` is a real PostgreSQL enum, and a database that was upgraded rather than
created by `create_all` has only the members the migrations declare. A kind added to
`SecretKind` without a matching `ALTER TYPE ... ADD VALUE` therefore fails at the first
insert, on every deployment that is not a fresh install, and never in a unit suite that
uses fake DAOs.

The comparison is derived on both sides — the enum members and the migration statements —
so a new kind fails this test until its migration exists, rather than the two names anyone
happened to think of.
"""

import re
from pathlib import Path
from typing import Set

from oss.src.core.secrets.enums import SecretKind


# The OSS chain (`core` + `core_oss`). EE keeps its own copies of the shared `core`
# revisions and applies this chain too, so a member declared here is declared everywhere.
MIGRATIONS_ROOT = (
    Path(__file__).resolve().parents[4] / "databases" / "postgres" / "migrations"
)

# `op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'X'")`, with or without
# the IF NOT EXISTS clause and over a line break.
_ADD_VALUE = re.compile(
    r"ALTER\s+TYPE\s+secretkind_enum\s+ADD\s+VALUE"
    r"(?:\s+IF\s+NOT\s+EXISTS)?\s+'([A-Z_]+)'",
    re.IGNORECASE,
)
# `sa.Enum("PROVIDER_KEY", "CUSTOM_PROVIDER", name="secretkind_enum")`, the creation.
_ENUM_CREATE = re.compile(r"sa\.Enum\(([^)]*?)name=\"secretkind_enum\"\)", re.DOTALL)
_QUOTED = re.compile(r"\"([A-Z_]+)\"")


def declared_secret_kinds() -> Set[str]:
    """Every member the OSS migration chain puts on `secretkind_enum`."""
    declared: Set[str] = set()

    for path in MIGRATIONS_ROOT.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        if "secretkind_enum" not in source:
            continue
        declared |= set(_ADD_VALUE.findall(source))
        for created in _ENUM_CREATE.findall(source):
            declared |= set(_QUOTED.findall(created))

    return declared


def test_every_secret_kind_the_code_writes_is_declared_by_a_migration():
    declared = declared_secret_kinds()
    assert declared, f"no secretkind_enum statements found under {MIGRATIONS_ROOT}"

    missing = {kind.name for kind in SecretKind} - declared

    assert not missing, (
        "these SecretKind members are written by the code but no migration adds them to "
        f"secretkind_enum, so they fail on any migrated database: {sorted(missing)}"
    )
