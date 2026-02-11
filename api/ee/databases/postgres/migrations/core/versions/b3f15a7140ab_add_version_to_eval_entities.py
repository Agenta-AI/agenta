"""Add version to evaluation entities

Revision ID: b3f15a7140ab
Revises: 5a71b3f140ab
Create Date: 2025-10-03 14:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b3f15a7140ab"
down_revision: Union[str, None] = "5a71b3f140ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # BASED ON
    # version = Column(
    #     String,
    #     nullable=True,
    # )

    # EVALUATION RUNS ----------------------------------------------------------

    op.add_column(
        "evaluation_runs",
        sa.Column(
            "version",
            sa.String(),
            nullable=True,
        ),
    )

    # EVALUATION SCENARIOS -----------------------------------------------------

    op.add_column(
        "evaluation_scenarios",
        sa.Column(
            "version",
            sa.String(),
            nullable=True,
        ),
    )

    # EVALUATION RESULTS -------------------------------------------------------

    op.add_column(
        "evaluation_results",
        sa.Column(
            "version",
            sa.String(),
            nullable=True,
        ),
    )

    # EVALUATION METRICS -------------------------------------------------------

    op.add_column(
        "evaluation_metrics",
        sa.Column(
            "version",
            sa.String(),
            nullable=True,
        ),
    )

    # EVALUATION QUEUES --------------------------------------------------------

    op.add_column(
        "evaluation_queues",
        sa.Column(
            "version",
            sa.String(),
            nullable=True,
        ),
    )

    # --------------------------------------------------------------------------


def downgrade() -> None:
    # EVALUATION QUEUES --------------------------------------------------------

    op.drop_column("evaluation_queues", "version")

    # EVALUATION METRICS -------------------------------------------------------

    op.drop_column("evaluation_metrics", "version")

    # EVALUATION RESULTS -------------------------------------------------------

    op.drop_column("evaluation_results", "version")

    # EVALUATION SCENARIOS -----------------------------------------------------

    op.drop_column("evaluation_scenarios", "version")

    # EVALUATION RUNS ----------------------------------------------------------

    op.drop_column("evaluation_runs", "version")

    # --------------------------------------------------------------------------
