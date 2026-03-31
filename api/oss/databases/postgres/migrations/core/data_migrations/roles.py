import click
from sqlalchemy import bindparam, text, Connection


ROLE_MAP = {
    "editor": "admin",
    "workspace_admin": "admin",
    "deployment_manager": "manager",
    "evaluator": "annotator",
}

# Roles that are not allowed to own API keys after migration.
# `viewer` and `annotator` are disallowed, so we delete their keys
# before renaming.
DISALLOWED_API_KEY_ROLES = ("viewer", "evaluator")


def _rename_roles_in_table(session: Connection, table: str) -> None:
    """Apply ROLE_MAP renames to a single table's `role` column."""

    for old_role, new_role in ROLE_MAP.items():
        session.execute(
            text(f"UPDATE {table} SET role = :new_role WHERE role = :old_role"),
            {"old_role": old_role, "new_role": new_role},
        )


def _revert_roles_in_table(session: Connection, table: str) -> None:
    """Revert canonical role names back to legacy names in a single table.

    `admin` maps from both `editor` and `workspace_admin`. On downgrade
    we restore to `editor` since the distinction is lost post-migration.
    """

    reverse_map = {new: old for old, new in ROLE_MAP.items()}
    reverse_map["admin"] = "editor"

    for old_role, new_role in reverse_map.items():
        session.execute(
            text(f"UPDATE {table} SET role = :new_role WHERE role = :old_role"),
            {"old_role": old_role, "new_role": new_role},
        )


def migrate_invitations_to_canonical_names(session: Connection) -> None:
    """Rename old role strings in project_invitations to canonical names.

    This is the OSS-scoped part of the role migration. Tables
    workspace_members and project_members are EE-only and are handled
    by the EE migration.

    Mapping applied:
      editor           -> admin
      workspace_admin  -> admin
      deployment_manager -> manager
    """

    _rename_roles_in_table(session, "project_invitations")

    click.echo(
        click.style(
            "Successfully migrated project_invitations roles to canonical names.",
            fg="green",
        ),
        color=True,
    )


def revert_invitations_to_legacy_names(session: Connection) -> None:
    """Revert canonical role names in project_invitations back to legacy names."""

    _revert_roles_in_table(session, "project_invitations")

    click.echo(
        click.style(
            "Successfully reverted project_invitations roles to legacy names.",
            fg="green",
        ),
        color=True,
    )


def migrate_roles_to_canonical_names(session: Connection) -> None:
    """Rename old role strings to canonical names across all EE membership tables.

    Mapping applied:
      editor           -> admin
      workspace_admin  -> admin
      deployment_manager -> manager

    API keys owned by users whose project role is `viewer` or `annotator`
    are deleted first, because post-migration those roles are not permitted
    to hold API keys.

    Also renames roles in project_invitations (shared with OSS).
    """

    # 1. Delete API keys owned by disallowed-role users before renaming.
    delete_disallowed_api_keys = text(
        """
        DELETE FROM api_keys
        WHERE id IN (
            SELECT ak.id
            FROM api_keys ak
            JOIN project_members pm
              ON pm.project_id = ak.project_id
             AND pm.user_id = ak.created_by_id
            WHERE pm.role IN :disallowed_roles
        )
        """
    ).bindparams(bindparam("disallowed_roles", expanding=True))
    session.execute(
        delete_disallowed_api_keys,
        {"disallowed_roles": DISALLOWED_API_KEY_ROLES},
    )

    # 2. Rename roles in workspace_members.
    _rename_roles_in_table(session, "workspace_members")

    # 3. Rename roles in project_members.
    _rename_roles_in_table(session, "project_members")

    # 4. Rename roles in project_invitations.
    _rename_roles_in_table(session, "project_invitations")

    click.echo(
        click.style(
            "Successfully migrated roles to canonical names "
            "(workspace_members, project_members, project_invitations, api_keys).",
            fg="green",
        ),
        color=True,
    )


def revert_roles_to_legacy_names(session: Connection) -> None:
    """Revert canonical role names back to legacy names across all EE membership tables.

    Note: API keys deleted during the forward migration cannot be restored.
    """

    _revert_roles_in_table(session, "workspace_members")
    _revert_roles_in_table(session, "project_members")
    _revert_roles_in_table(session, "project_invitations")

    click.echo(
        click.style(
            "Successfully reverted roles to legacy names "
            "(workspace_members, project_members, project_invitations).",
            fg="green",
        ),
        color=True,
    )
