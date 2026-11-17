"""give every agent drive a slug and state the drives of every agent revision

Release 2 of drive sharing (contract). It runs only after every API pod and agent
service runs release 1. Data only, no schema change.

| Step | Change |
| --- | --- |
| 1 | An agent drive with a reserved `__ag__agent__` slug and an artifact in the database gets a readable slug `<agent slug>-files` (`-2`, `-3` ... on a collision). `agent_id` and the storage prefix stay, so every file stays where it is. |
| 2 | An agent that has no drive row and is not archived gets one, with the same slug rule. |
| 3 | Every agent drive without a `mount_visibility` row gets one copied from `agent_access` (`project` with no owner when the agent has no row). |
| 4 | Every other drive with no session and no visibility row gets `project` with no owner. |
| 5 | In every agent revision, a reserved agent slug in `drives` or `home_drive` becomes the drive's slug, and missing keys are added: `has_session_drive: true`, and when `drives` is absent, the agent's own drive as the only entry and as home if the home rule allows it, else `drives: []` and `home_drive: null`. |

A static catalog agent has no artifact in the database: its drive keeps its reserved slug
and gets no visibility row. A stated JSON null counts as absent, except in `home_drive`,
where a stated value (null included) is kept, as the app's fill keeps it. The slug rule and the
fill are frozen copies, not imports, so this revision does what it did when it was
written. A second run changes nothing.

Revision ID: oss000000064
Revises: oss000000063
Create Date: 2026-11-17 00:00:00.000000
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Dict, Optional, Sequence, Set, Tuple, Union
from uuid import UUID

import sqlalchemy as sa
import uuid_utils
from alembic import op

revision: str = "oss000000064"
down_revision: Union[str, None] = "oss000000063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

BATCH_SIZE = 500

_RESERVED_AGENT_SLUG = re.compile(
    r"^__ag__agent__([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})__"
)

_RESERVED_AGENT_DRIVES_SQL = r"""
SELECT m.project_id, m.id, a.slug
FROM mounts m
JOIN workflow_artifacts a ON a.project_id = m.project_id AND a.id::text = m.agent_id
WHERE m.slug LIKE '\_\_ag\_\_agent\_\_%' ESCAPE '\'
ORDER BY m.project_id, m.created_at, m.id
"""

_AGENTS_WITHOUT_DRIVE_SQL = """
SELECT a.project_id, a.id, a.slug, a.name, a.created_by_id
FROM workflow_artifacts a
JOIN projects p ON p.id = a.project_id AND p.organization_id IS NOT NULL
WHERE a.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM workflow_revisions r
    WHERE r.project_id = a.project_id AND r.artifact_id = a.id
      AND r.flags @> '{"is_agent": true}'::jsonb
  )
  AND NOT EXISTS (
    SELECT 1 FROM mounts m
    WHERE m.project_id = a.project_id AND m.agent_id = a.id::text
  )
ORDER BY a.project_id, a.created_at, a.id
"""

_TAKEN_SLUGS_SQL = "SELECT slug FROM mounts WHERE project_id = :project_id"

_RENAME_SQL = """
UPDATE mounts SET slug = :slug, updated_at = :now
WHERE project_id = :project_id AND id = :id
"""

_INSERT_DRIVE_SQL = """
INSERT INTO mounts (
    project_id, id, slug, name, agent_id, storage_prefix,
    data, flags, created_at, created_by_id
)
SELECT p.id, :id, :slug, :name, :agent_id,
       'mounts/' || p.organization_id::text || '/' || :id_text,
       CAST('{}' AS json), CAST('{}' AS jsonb), :now, :created_by_id
FROM projects p
WHERE p.id = :project_id
ON CONFLICT (project_id, agent_id) WHERE agent_id IS NOT NULL DO NOTHING
"""

_AGENT_DRIVE_VISIBILITY_SQL = """
INSERT INTO mount_visibility (project_id, mount_id, visibility, owner_user_id)
SELECT m.project_id, m.id, COALESCE(aa.visibility, 'project'), aa.owner_user_id
FROM mounts m
JOIN workflow_artifacts a ON a.project_id = m.project_id AND a.id::text = m.agent_id
LEFT JOIN agent_access aa
  ON aa.project_id = a.project_id AND aa.artifact_id = a.id
WHERE m.session_id IS NULL
ON CONFLICT (project_id, mount_id) DO NOTHING
"""

_PROJECT_DRIVE_VISIBILITY_SQL = """
INSERT INTO mount_visibility (project_id, mount_id, visibility, owner_user_id)
SELECT m.project_id, m.id, 'project', NULL
FROM mounts m
WHERE m.session_id IS NULL AND m.agent_id IS NULL
ON CONFLICT (project_id, mount_id) DO NOTHING
"""

_AGENT_DRIVES_SQL = """
SELECT m.project_id, m.agent_id, m.slug, mv.visibility, mv.owner_user_id
FROM mounts m
LEFT JOIN mount_visibility mv ON mv.project_id = m.project_id AND mv.mount_id = m.id
WHERE m.agent_id IS NOT NULL AND m.session_id IS NULL
"""

_AGENT_ACCESS_SQL = """
SELECT project_id, artifact_id::text, visibility, owner_user_id FROM agent_access
"""

# Read as text and merged in Python: json operators and jsonb refuse a stored "\u0000".
_READ_SQL = """
SELECT project_id, id, artifact_id::text, data::text
FROM workflow_revisions
WHERE flags @> '{"is_agent": true}'::jsonb
  AND data IS NOT NULL
  AND (project_id, id) > (:project_id, :id)
ORDER BY project_id, id
LIMIT :limit
"""

_WRITE_SQL = """
UPDATE workflow_revisions
SET data = CAST(:data AS json)
WHERE project_id = :project_id AND id = :id
"""

# (visibility, owner_user_id)
Policy = Tuple[str, Optional[UUID]]
# (slug, visibility row or None)
Drive = Tuple[str, Optional[Policy]]
Key = Tuple[UUID, str]


def _drive_slug(agent_slug: Optional[str], taken: Set[str]) -> str:
    """Frozen slug rule: `<agent slug>-files` as one path segment, unique in the project."""
    base = re.sub(r"[^a-z0-9]+", "-", (agent_slug or "").lower()).strip("-")
    base = f"{base[:60].strip('-') or 'agent'}-files"
    slug, suffix = base, 2
    while slug in taken:
        slug, suffix = f"{base}-{suffix}", suffix + 1
    return slug


def _home_allowed(agent: Policy, drive: Optional[Policy]) -> bool:
    """Frozen home rule of the fill, for the agent's own drive."""
    if drive is None:
        return False
    if agent[0] == "private":
        return drive[0] == "private" and drive[1] == agent[1]
    return drive[0] == "project"


def _merged(
    text: str,
    *,
    project_id: UUID,
    artifact_id: str,
    drives: Dict[Key, Drive],
    agents: Dict[Key, Policy],
) -> Optional[str]:
    """The data with renamed references and missing keys, or None when nothing changes."""
    data = json.loads(text)
    parameters = data.get("parameters") if isinstance(data, dict) else None
    agent = parameters.get("agent") if isinstance(parameters, dict) else None
    if not isinstance(agent, dict):
        return None
    changed = False

    def renamed(slug):
        match = _RESERVED_AGENT_SLUG.match(slug) if isinstance(slug, str) else None
        drive = drives.get((project_id, match.group(1))) if match else None
        if drive is None or _RESERVED_AGENT_SLUG.match(drive[0]):
            return slug
        return drive[0]

    entries = agent.get("drives") if isinstance(agent.get("drives"), list) else []
    for entry in (e for e in entries if isinstance(e, dict)):
        slug = renamed(entry.get("slug"))
        if slug != entry.get("slug"):
            entry["slug"] = slug
            changed = True
    home = renamed(agent.get("home_drive"))
    if home != agent.get("home_drive"):
        agent["home_drive"] = home
        changed = True

    if agent.get("has_session_drive") is None:
        agent["has_session_drive"] = True
        changed = True
    if agent.get("drives") is None:
        own = drives.get((project_id, artifact_id))
        policy = agents.get((project_id, artifact_id), ("project", None))
        if (
            own is not None
            and not _RESERVED_AGENT_SLUG.match(own[0])
            and _home_allowed(policy, own[1])
        ):
            agent["drives"] = [{"slug": own[0]}]
            agent.setdefault("home_drive", own[0])
        else:
            agent["drives"] = []
            agent.setdefault("home_drive", None)
        changed = True
    return json.dumps(data) if changed else None


def _name_drives(connection) -> Tuple[int, int]:
    now = datetime.now(timezone.utc)
    taken: Dict[UUID, Set[str]] = {}

    def taken_in(project_id: UUID) -> Set[str]:
        if project_id not in taken:
            taken[project_id] = set(
                connection.execute(
                    sa.text(_TAKEN_SLUGS_SQL), {"project_id": project_id}
                ).scalars()
            )
        return taken[project_id]

    renamed = 0
    for project_id, mount_id, agent_slug in connection.execute(
        sa.text(_RESERVED_AGENT_DRIVES_SQL)
    ).all():
        slug = _drive_slug(agent_slug, taken_in(project_id))
        connection.execute(
            sa.text(_RENAME_SQL),
            {"project_id": project_id, "id": mount_id, "slug": slug, "now": now},
        )
        taken[project_id].add(slug)
        renamed += 1

    created = 0
    for project_id, artifact_id, agent_slug, name, created_by_id in connection.execute(
        sa.text(_AGENTS_WITHOUT_DRIVE_SQL)
    ).all():
        slug = _drive_slug(agent_slug, taken_in(project_id))
        mount_id = UUID(str(uuid_utils.uuid7()))
        result = connection.execute(
            sa.text(_INSERT_DRIVE_SQL),
            {
                "project_id": project_id,
                "id": mount_id,
                "id_text": str(mount_id),
                "slug": slug,
                "name": name or agent_slug or "Agent files",
                "agent_id": str(artifact_id),
                "now": now,
                "created_by_id": created_by_id,
            },
        )
        taken[project_id].add(slug)
        created += result.rowcount
    return renamed, created


def _state_drives(connection, *, batch_size: int) -> int:
    drives: Dict[Key, Drive] = {
        (project_id, agent_id): (
            slug,
            (visibility, owner) if visibility is not None else None,
        )
        for project_id, agent_id, slug, visibility, owner in connection.execute(
            sa.text(_AGENT_DRIVES_SQL)
        ).all()
    }
    agents: Dict[Key, Policy] = {
        (project_id, artifact_id): (visibility, owner)
        for project_id, artifact_id, visibility, owner in connection.execute(
            sa.text(_AGENT_ACCESS_SQL)
        ).all()
    }
    changed = 0
    last = {"project_id": UUID(int=0), "id": UUID(int=0)}
    while True:
        rows = connection.execute(
            sa.text(_READ_SQL), {**last, "limit": batch_size}
        ).all()
        if not rows:
            return changed
        updates = []
        for project_id, revision_id, artifact_id, text in rows:
            merged = _merged(
                text,
                project_id=project_id,
                artifact_id=artifact_id,
                drives=drives,
                agents=agents,
            )
            if merged is not None:
                updates.append(
                    {"project_id": project_id, "id": revision_id, "data": merged}
                )
        if updates:
            connection.execute(sa.text(_WRITE_SQL), updates)
            changed += len(updates)
        last = {"project_id": rows[-1][0], "id": rows[-1][1]}


def _backfill(connection, *, batch_size: int = BATCH_SIZE) -> Dict[str, int]:
    renamed, created = _name_drives(connection)
    agent_rows = connection.execute(sa.text(_AGENT_DRIVE_VISIBILITY_SQL)).rowcount
    project_rows = connection.execute(sa.text(_PROJECT_DRIVE_VISIBILITY_SQL)).rowcount
    revisions = _state_drives(connection, batch_size=batch_size)
    return {
        "renamed": renamed,
        "created": created,
        "agent_visibility": agent_rows,
        "project_visibility": project_rows,
        "revisions": revisions,
    }


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    counts = _backfill(op.get_bind())
    log.info(
        "agent drives: %(renamed)s renamed, %(created)s created; visibility rows: "
        "%(agent_visibility)s agent, %(project_visibility)s project; "
        "%(revisions)s agent revisions written",
        counts,
    )


def downgrade() -> None:
    # Nothing to undo: the database is never rolled back on a failed deploy, and
    # release 1 reads the readable slugs, the visibility rows and the stated keys.
    pass
