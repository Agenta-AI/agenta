"""Populate runs flags

Revision ID: 652f6113b5f5
Revises: 79f40f71e912
Create Date: 2025-11-23 12:00:00
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import json

# revision identifiers, used by Alembic.
revision: str = "652f6113b5f5"
down_revision: Union[str, None] = "79f40f71e912"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _as_dict(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return None
    return None


def upgrade() -> None:
    conn = op.get_bind()

    rows = conn.execute(
        sa.text("SELECT id, data, flags FROM evaluation_runs")
    ).fetchall()

    for run_id, data_raw, flags_raw in rows:
        # Start with all flags False
        flags_out = {
            "is_live": False,
            "is_active": False,
            "is_closed": False,
            "has_queries": False,
            "has_testsets": False,
            "has_evaluators": False,
            "has_custom": False,
            "has_human": False,
            "has_auto": False,
        }

        data = _as_dict(data_raw)
        existing_flags = _as_dict(flags_raw)

        # 1) Overlay existing is_* flags (if any) onto the base flags
        if isinstance(existing_flags, dict):
            for key in ("is_live", "is_active", "is_closed"):
                if key in existing_flags and existing_flags[key] is not None:
                    # Expecting booleans here, but be defensive
                    flags_out[key] = bool(existing_flags[key])

        # 2) Recompute has_* flags from data.steps (like _make_run_flags)
        if isinstance(data, dict):
            steps = data.get("steps", [])
            if isinstance(steps, list):
                for step in steps:
                    if not isinstance(step, dict):
                        continue

                    step_type = step.get("type")

                    # Input steps: infer queries/testsets from reference keys
                    if step_type == "input":
                        refs = step.get("references") or {}
                        if isinstance(refs, dict):
                            for key in refs.keys():
                                key_str = str(key).lower()
                                if "query" in key_str:
                                    flags_out["has_queries"] = True
                                if "testset" in key_str:
                                    flags_out["has_testsets"] = True

                    # Annotation steps: evaluators + origin
                    if step_type == "annotation":
                        flags_out["has_evaluators"] = True
                        origin = step.get("origin")
                        if origin == "custom":
                            flags_out["has_custom"] = True
                        elif origin == "human":
                            flags_out["has_human"] = True
                        elif origin == "auto":
                            flags_out["has_auto"] = True

        conn.execute(
            sa.text("UPDATE evaluation_runs SET flags = :flags WHERE id = :id"),
            {"flags": json.dumps(flags_out), "id": run_id},
        )


def downgrade() -> None:
    pass
