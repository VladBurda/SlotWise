"""Users, revocable sessions, workspaces, invitations and durable auth mail."""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = [
        """CREATE TABLE users (
            id UUID PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE,
            name VARCHAR(100) NOT NULL, password_hash VARCHAR(255) NOT NULL,
            verified BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL)""",
        """CREATE TABLE sessions (
            id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            access_hash VARCHAR(64) NOT NULL UNIQUE, csrf_hash VARCHAR(64) NOT NULL,
            access_expires TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
            revoked BOOLEAN NOT NULL)""",
        "CREATE INDEX ix_sessions_user_id ON sessions(user_id)",
        """CREATE TABLE refresh_tokens (
            token_hash VARCHAR(64) PRIMARY KEY,
            session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            consumed BOOLEAN NOT NULL)""",
        "CREATE INDEX ix_refresh_tokens_session_id ON refresh_tokens(session_id)",
        """CREATE TABLE action_tokens (
            token_hash VARCHAR(64) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            purpose VARCHAR(20) NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
            consumed BOOLEAN NOT NULL)""",
        "CREATE INDEX ix_action_tokens_user_id ON action_tokens(user_id)",
        """CREATE TABLE workspaces (
            id UUID PRIMARY KEY, name VARCHAR(100) NOT NULL, slug VARCHAR(64) NOT NULL UNIQUE,
            timezone VARCHAR(64) NOT NULL, suspended BOOLEAN NOT NULL,
            created_at TIMESTAMPTZ NOT NULL)""",
        """CREATE TABLE memberships (
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL CHECK(role IN ('owner','manager','employee','customer')),
            PRIMARY KEY(workspace_id,user_id))""",
        """CREATE TABLE invitations (
            id UUID PRIMARY KEY,
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            email VARCHAR(254) NOT NULL,
            role VARCHAR(20) NOT NULL CHECK(role IN ('owner','manager','employee','customer')),
            token_hash VARCHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL,
            accepted BOOLEAN NOT NULL, revoked BOOLEAN NOT NULL, UNIQUE(workspace_id,id))""",
        "CREATE INDEX ix_invitations_workspace_id ON invitations(workspace_id)",
        """CREATE TABLE audit_logs (
            id UUID PRIMARY KEY,
            workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
            actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(80) NOT NULL, object_id VARCHAR(64) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL)""",
        "CREATE INDEX ix_audit_logs_workspace_id ON audit_logs(workspace_id)",
        """CREATE TABLE auth_mail (
            id UUID PRIMARY KEY, payload TEXT NOT NULL, attempts INTEGER NOT NULL,
            next_attempt TIMESTAMPTZ NOT NULL, delivered_at TIMESTAMPTZ,
            last_error VARCHAR(50))""",
        "CREATE INDEX ix_auth_mail_next_attempt ON auth_mail(next_attempt)",
    ]
    for statement in statements:
        op.execute(statement)


def downgrade() -> None:
    for table in (
        "auth_mail",
        "audit_logs",
        "invitations",
        "memberships",
        "workspaces",
        "action_tokens",
        "refresh_tokens",
        "sessions",
        "users",
    ):
        op.drop_table(table)
