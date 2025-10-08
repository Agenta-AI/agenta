"""Populate runs references

Revision ID: 3b5f5652f611
Revises: b3f15a7140ab
Create Date: 2025-10-07 12:00:00
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import json

# revision identifiers, used by Alembic.
revision: str = "3b5f5652f611"
down_revision: Union[str, None] = "b3f15a7140ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    rows = conn.execute(
        sa.text('SELECT id, data, "references" FROM evaluation_runs')
    ).fetchall()

    for run_id, data, existing_refs in rows:
        if existing_refs not in (None, [], {}):
            continue
        if not data or "steps" not in data:
            continue

        refs_out = []
        seen = set()

        for step in data.get("steps", []):
            refs = step.get("references", {})
            if not isinstance(refs, dict):
                continue

            for key, ref in refs.items():
                if not isinstance(ref, dict):
                    continue

                entry = {"key": key}

                if ref.get("id") is not None:
                    entry["id"] = ref["id"]
                if ref.get("slug") is not None:
                    entry["slug"] = ref["slug"]
                if ref.get("version") is not None:
                    entry["version"] = ref["version"]

                dedup_key = (
                    entry.get("id"),
                    entry["key"],
                    entry.get("slug"),
                    entry.get("version"),
                )
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                refs_out.append(entry)

        if refs_out:
            conn.execute(
                sa.text(
                    'UPDATE evaluation_runs SET "references" = :refs WHERE id = :id'
                ),
                {"refs": json.dumps(refs_out), "id": run_id},
            )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text('UPDATE evaluation_runs SET "references" = NULL'))
