from sqlalchemy import bindparam, text, Connection


ROLE_MAP = {
    "editor": "admin",
    "workspace_admin": "admin",
    "deployment_manager": "manager",
    "viewer": "auditor",
}

# Roles that are not allowed to own API keys after migration.
# `viewer` maps to `auditor`; `evaluator` stays `evaluator`.
# Both are disallowed, so we delete their keys before renaming.
DISALLOWED_API_KEY_ROLES = ("viewer", "auditor", "evaluator")


def migrate_invitations_to_canonical_names(session: Connection) -> None:
    """Rename old role strings in project_invitations to canonical names.

    This is the OSS-scoped part of the role migration. Tables
    workspace_members and project_members are EE-only and are handled
    by the EE migration.

    Mapping applied:
      editor           -> admin
      workspace_admin  -> admin
      deployment_manager -> manager
      viewer           -> auditor
    """

    for old_role, new_role in ROLE_MAP.items():
        session.execute(
            text(
                "UPDATE project_invitations SET role = :new_role WHERE role = :old_role"
            ),
            {"old_role": old_role, "new_role": new_role},
        )

    session.commit()


def revert_invitations_to_legacy_names(session: Connection) -> None:
    """Revert canonical role names in project_invitations back to legacy names."""

    reverse_map = {new: old for old, new in ROLE_MAP.items()}

    # `admin` maps from both `editor` and `workspace_admin`. On downgrade
    # we restore to `editor` since the distinction is lost post-migration.
    reverse_map["admin"] = "editor"

    for old_role, new_role in reverse_map.items():
        session.execute(
            text(
                "UPDATE project_invitations SET role = :new_role WHERE role = :old_role"
            ),
            {"old_role": old_role, "new_role": new_role},
        )

    session.commit()


def migrate_roles_to_canonical_names(session: Connection) -> None:
    """Rename old role strings to canonical names across all EE membership tables.

    Mapping applied:
      editor           -> admin
      workspace_admin  -> admin
      deployment_manager -> manager
      viewer           -> auditor

    API keys owned by users whose project role is `viewer` or `evaluator` are
    deleted first, because post-migration those roles (`auditor` / `evaluator`)
    are not permitted to hold API keys.

    Also delegates to migrate_invitations_to_canonical_names for the shared
    project_invitations table.
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
    for old_role, new_role in ROLE_MAP.items():
        session.execute(
            text(
                "UPDATE workspace_members SET role = :new_role WHERE role = :old_role"
            ),
            {"old_role": old_role, "new_role": new_role},
        )

    # 3. Rename roles in project_members.
    for old_role, new_role in ROLE_MAP.items():
        session.execute(
            text("UPDATE project_members SET role = :new_role WHERE role = :old_role"),
            {"old_role": old_role, "new_role": new_role},
        )

    # 4. Rename roles in project_invitations.
    migrate_invitations_to_canonical_names(session=session)


def revert_roles_to_legacy_names(session: Connection) -> None:
    """Revert canonical role names back to legacy names across all EE membership tables.

    Note: API keys deleted during the forward migration cannot be restored.
    """

    reverse_map = {new: old for old, new in ROLE_MAP.items()}

    # `admin` maps from both `editor` and `workspace_admin`. On downgrade
    # we restore to `editor` since the distinction is lost post-migration.
    reverse_map["admin"] = "editor"

    for old_role, new_role in reverse_map.items():
        session.execute(
            text(
                "UPDATE workspace_members SET role = :new_role WHERE role = :old_role"
            ),
            {"old_role": old_role, "new_role": new_role},
        )

    for old_role, new_role in reverse_map.items():
        session.execute(
            text("UPDATE project_members SET role = :new_role WHERE role = :old_role"),
            {"old_role": old_role, "new_role": new_role},
        )

    revert_invitations_to_legacy_names(session=session)
