from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d0dca996e123"
down_revision: Union[str, None] = "55bdd2e9a465"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS hstore;")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS hstore;")
