"""Opt-in public booking pages and explicit customer ownership."""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column(
            "public_booking_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "workspaces",
        sa.Column("public_booking_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("appointments", sa.Column("customer_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_appointments_customer_user_id_users",
        "appointments",
        "users",
        ["customer_user_id"],
        ["id"],
    )
    op.create_index("ix_appointments_customer_user_id", "appointments", ["customer_user_id"])


def downgrade() -> None:
    op.drop_index("ix_appointments_customer_user_id", table_name="appointments")
    op.drop_constraint("fk_appointments_customer_user_id_users", "appointments", type_="foreignkey")
    op.drop_column("appointments", "customer_user_id")
    op.drop_column("workspaces", "public_booking_version")
    op.drop_column("workspaces", "public_booking_enabled")
