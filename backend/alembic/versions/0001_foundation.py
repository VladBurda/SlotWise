"""Enable range exclusion support; domain tables arrive with their owning phases."""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")


def downgrade() -> None:
    # Shared extension intentionally retained; other schemas may depend on it.
    pass
