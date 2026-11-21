"""Business profile, locations and local operating rules."""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE business_profiles (
        workspace_id UUID PRIMARY KEY REFERENCES workspaces(id),
        version INTEGER NOT NULL, description VARCHAR(2000) NOT NULL,
        contact_email VARCHAR(254), phone VARCHAR(50) NOT NULL, policies JSONB NOT NULL
    )""")
    op.execute("""CREATE TABLE locations (
        id UUID PRIMARY KEY, workspace_id UUID NOT NULL REFERENCES workspaces(id),
        version INTEGER NOT NULL, name VARCHAR(100) NOT NULL, address VARCHAR(500) NOT NULL,
        timezone VARCHAR(64) NOT NULL, active BOOLEAN NOT NULL, UNIQUE(workspace_id,id)
    )""")
    op.execute("CREATE INDEX ix_locations_workspace_id ON locations(workspace_id)")
    op.execute("""CREATE TABLE opening_rules (
        workspace_id UUID NOT NULL, location_id UUID NOT NULL, weekday INTEGER NOT NULL,
        start INTEGER NOT NULL, finish INTEGER NOT NULL,
        PRIMARY KEY(workspace_id,location_id,weekday,start),
        FOREIGN KEY(workspace_id,location_id) REFERENCES locations(workspace_id,id),
        CONSTRAINT ck_opening_rules_weekday CHECK(weekday BETWEEN 0 AND 6),
        CONSTRAINT ck_opening_rules_interval CHECK(start >= 0 AND start < finish AND finish <= 1440)
    )""")
    op.execute("""CREATE TABLE operating_exceptions (
        workspace_id UUID NOT NULL, location_id UUID NOT NULL, day DATE NOT NULL,
        kind VARCHAR(10) NOT NULL, label VARCHAR(100) NOT NULL,
        PRIMARY KEY(workspace_id,location_id,day),
        FOREIGN KEY(workspace_id,location_id) REFERENCES locations(workspace_id,id),
        CONSTRAINT ck_operating_exceptions_kind CHECK(kind IN ('holiday','special'))
    )""")
    op.execute("""CREATE TABLE exception_windows (
        workspace_id UUID NOT NULL, location_id UUID NOT NULL, day DATE NOT NULL,
        start INTEGER NOT NULL, finish INTEGER NOT NULL,
        PRIMARY KEY(workspace_id,location_id,day,start),
        FOREIGN KEY(workspace_id,location_id,day)
            REFERENCES operating_exceptions(workspace_id,location_id,day) ON DELETE CASCADE,
        CONSTRAINT ck_exception_windows_interval
            CHECK(start >= 0 AND start < finish AND finish <= 1440)
    )""")


def downgrade() -> None:
    for name in (
        "exception_windows",
        "operating_exceptions",
        "opening_rules",
        "locations",
        "business_profiles",
    ):
        op.drop_table(name)
