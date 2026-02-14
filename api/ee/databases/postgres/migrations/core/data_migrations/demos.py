from os import getenv
from uuid import UUID
from json import loads
from functools import wraps
from traceback import format_exc
from typing import List, Optional

from click import echo, style
from pydantic import BaseModel


from sqlalchemy import Connection, delete, insert
from sqlalchemy.future import select

from oss.src.models.db_models import (
    ProjectDB,
    UserDB,
)
from ee.src.models.db_models import (
    OrganizationMemberDB,
    WorkspaceMemberDB,
    ProjectMemberDB,
)


BATCH_SIZE = 100
DEMOS = "AGENTA_DEMOS"
DEMO_ROLE = "viewer"
OWNER_ROLE = "owner"


class Demo(BaseModel):
    organization_id: UUID
    workspace_id: UUID
    project_id: UUID


class User(BaseModel):
    user_id: UUID


class Member(BaseModel):
    user_id: UUID

    organization_id: Optional[UUID] = None
    workspace_id: Optional[UUID] = None
    project_id: Optional[UUID] = None

    role: Optional[str] = None


def with_rollback():
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                session = kwargs.get("session")

                session.rollback()

                log_error(format_exc())

                raise exc

        return wrapper

    return decorator


def log_info(message) -> None:
    echo(style(f"{message}", fg="green"), color=True)


def log_error(message) -> None:
    echo(style(f"ERROR: {message}", fg="red"), color=True)


def fetch_project(
    session: Connection,
    project_id: UUID,
) -> ProjectDB:
    result = session.execute(
        select(
            ProjectDB.id,
            ProjectDB.workspace_id,
            ProjectDB.organization_id,
        ).where(
            ProjectDB.id == project_id,
        )
    ).first()

    project = ProjectDB(
        id=result.id,
        workspace_id=result.workspace_id,
        organization_id=result.organization_id,
    )

    return project


def list_all_demos(session: Connection) -> List[Demo]:
    demos = []

    try:
        demo_project_ids = loads(getenv(DEMOS) or "[]")

        for project_id in demo_project_ids:
            project = fetch_project(
                session,
                project_id,
            )

            try:
                demos.append(
                    Demo(
                        organization_id=project.organization_id,
                        workspace_id=project.workspace_id,
                        project_id=project_id,
                    )
                )

            except Exception:  # pylint: disable=bare-except
                pass

    except Exception:  # pylint: disable=bare-except
        pass

    return demos


def list_all_users(
    session: Connection,
) -> List[User]:
    user_ids = session.execute(select(UserDB.id)).scalars().all()

    all_users = [User(user_id=user_id) for user_id in user_ids]

    return all_users


def fetch_organization_members(
    session: Connection,
    organization_id: UUID,
) -> List[Member]:
    result = session.execute(
        select(
            OrganizationMemberDB.user_id,
            OrganizationMemberDB.organization_id,
        ).where(
            OrganizationMemberDB.organization_id == organization_id,
        )
    ).all()

    organization_members = [
        Member(
            user_id=row.user_id,
            organization_id=row.organization_id,
        )
        for row in result
    ]

    return organization_members


def get_new_organization_members(
    users: List[User],
    members: List[Member],
) -> List[Member]:
    user_ids = {user.user_id for user in users}
    member_user_ids = {member.user_id for member in members}

    new_user_ids = user_ids - member_user_ids

    new_members = [Member(user_id=user_id) for user_id in new_user_ids]

    return new_members


def add_new_members_to_organization(
    session: Connection,
    organization_id: UUID,
    new_members: List[Member],
) -> None:
    for i in range(0, len(new_members), BATCH_SIZE):
        batch = new_members[i : i + BATCH_SIZE]

        values = [
            {
                "user_id": member.user_id,
                "organization_id": organization_id,
            }
            for member in batch
        ]

        session.execute(insert(OrganizationMemberDB).values(values))


def remove_all_members_from_organization(
    session: Connection,
    organization_id: UUID,
) -> None:
    session.execute(
        delete(OrganizationMemberDB).where(
            OrganizationMemberDB.organization_id == organization_id,
        )
    )


def fetch_workspace_members(
    session: Connection,
    workspace_id: UUID,
) -> List[Member]:
    result = session.execute(
        select(
            WorkspaceMemberDB.user_id,
            WorkspaceMemberDB.workspace_id,
            WorkspaceMemberDB.role,
        ).where(
            WorkspaceMemberDB.workspace_id == workspace_id,
        )
    ).all()

    members = [
        Member(
            user_id=row.user_id,
            workspace_id=row.workspace_id,
            role=row.role,
        )
        for row in result
    ]

    return members


def get_faulty_workspace_members(
    members: List[Member],
) -> List[Member]:
    member_user_ids = {
        member.user_id
        for member in members
        if member.role not in [DEMO_ROLE, OWNER_ROLE]
    }

    new_members = [Member(user_id=user_id) for user_id in member_user_ids]

    return new_members


def remove_faulty_workspace_members(
    session: Connection,
    workspace_id: UUID,
    faulty_members: List[Member],
) -> None:
    faulty_user_ids = [member.user_id for member in faulty_members]

    for i in range(0, len(faulty_user_ids), BATCH_SIZE):
        batch = faulty_user_ids[i : i + BATCH_SIZE]

        session.execute(
            delete(WorkspaceMemberDB)
            .where(WorkspaceMemberDB.workspace_id == workspace_id)
            .where(WorkspaceMemberDB.user_id.in_(batch))
        )


def get_new_workspace_members(
    users: List[User],
    members: List[Member],
) -> List[Member]:
    user_ids = {user.user_id for user in users}
    member_user_ids = {
        member.user_id for member in members if member.role in [DEMO_ROLE, OWNER_ROLE]
    }

    new_user_ids = user_ids - member_user_ids

    new_members = [Member(user_id=user_id) for user_id in new_user_ids]

    return new_members


def add_new_members_to_workspace(
    session: Connection,
    workspace_id: UUID,
    new_members: List[Member],
) -> None:
    for i in range(0, len(new_members), BATCH_SIZE):
        batch = new_members[i : i + BATCH_SIZE]

        values = [
            {
                "user_id": member.user_id,
                "workspace_id": workspace_id,
                "role": DEMO_ROLE,
            }
            for member in batch
        ]

        session.execute(insert(WorkspaceMemberDB).values(values))


def remove_all_members_from_workspace(
    session: Connection,
    workspace_id: UUID,
) -> None:
    session.execute(
        delete(WorkspaceMemberDB).where(
            WorkspaceMemberDB.workspace_id == workspace_id,
        )
    )


def fetch_project_members(
    session: Connection,
    project_id: UUID,
) -> List[Member]:
    result = session.execute(
        select(
            ProjectMemberDB.user_id,
            ProjectMemberDB.project_id,
            ProjectMemberDB.role,
        ).where(
            ProjectMemberDB.project_id == project_id,
        )
    ).all()

    members = [
        Member(
            user_id=row.user_id,
            project_id=row.project_id,
            role=row.role,
        )
        for row in result
    ]

    return members


def get_faulty_project_members(
    members: List[Member],
) -> List[Member]:
    member_user_ids = {
        member.user_id
        for member in members
        if member.role not in [DEMO_ROLE, OWNER_ROLE]
    }

    new_members = [Member(user_id=user_id) for user_id in member_user_ids]

    return new_members


def remove_faulty_project_members(
    session: Connection,
    project_id: UUID,
    faulty_members: List[Member],
) -> None:
    faulty_user_ids = [member.user_id for member in faulty_members]

    for i in range(0, len(faulty_user_ids), BATCH_SIZE):
        batch = faulty_user_ids[i : i + BATCH_SIZE]

        session.execute(
            delete(ProjectMemberDB)
            .where(ProjectMemberDB.project_id == project_id)
            .where(ProjectMemberDB.user_id.in_(batch))
        )


def get_new_project_members(
    users: List[User],
    members: List[Member],
) -> List[Member]:
    user_ids = {user.user_id for user in users}
    member_user_ids = {
        member.user_id for member in members if member.role in [DEMO_ROLE, OWNER_ROLE]
    }

    new_user_ids = user_ids - member_user_ids

    new_members = [Member(user_id=user_id) for user_id in new_user_ids]

    return new_members


def add_new_members_to_project(
    session: Connection,
    project_id: UUID,
    new_members: List[Member],
) -> None:
    for i in range(0, len(new_members), BATCH_SIZE):
        batch = new_members[i : i + BATCH_SIZE]

        values = [
            {
                "user_id": member.user_id,
                "project_id": project_id,
                "role": DEMO_ROLE,
                "is_demo": True,
            }
            for member in batch
        ]

        session.execute(insert(ProjectMemberDB).values(values))


def remove_all_members_from_project(
    session: Connection,
    project_id: UUID,
) -> None:
    session.execute(
        delete(ProjectMemberDB).where(
            ProjectMemberDB.project_id == project_id,
        )
    )


@with_rollback()
def add_users_to_demos(session: Connection) -> None:
    log_info("Populating demos.")

    all_demos = list_all_demos(session)

    log_info(f"Found {len(all_demos)} demos.")

    all_users = list_all_users(session)

    log_info(f"Found {len(all_users)} users.")

    for i, demo in enumerate(all_demos):
        log_info(f"Populating demo #{i}.")

        # DEMO ORGANIZATIONS
        organization_members = fetch_organization_members(
            session,
            demo.organization_id,
        )

        log_info(f"Found {len(organization_members)} organization members.")

        new_organization_members = get_new_organization_members(
            all_users,
            organization_members,
        )

        log_info(f"Missing {len(new_organization_members)} organization members.")

        add_new_members_to_organization(
            session,
            demo.organization_id,
            new_organization_members,
        )

        log_info(f"Added {len(new_organization_members)} organization members.")
        # ------------------

        # DEMO WORKSPACES
        workspace_members = fetch_workspace_members(
            session,
            demo.workspace_id,
        )

        log_info(f"Found {len(workspace_members)} workspace members.")

        faulty_workspace_members = get_faulty_workspace_members(
            workspace_members,
        )

        log_info(f"Found {len(faulty_workspace_members)} faulty workspace members.")

        remove_faulty_workspace_members(
            session,
            demo.workspace_id,
            faulty_workspace_members,
        )

        log_info(f"Removed {len(faulty_workspace_members)} faulty workspace members.")

        new_workspace_members = get_new_workspace_members(
            all_users,
            workspace_members,
        )

        log_info(f"Missing {len(new_workspace_members)} workspace members.")

        add_new_members_to_workspace(
            session,
            demo.workspace_id,
            new_workspace_members,
        )

        log_info(f"Added {len(new_workspace_members)} workspace members.")
        # ---------------

        # DEMO PROJECTS
        project_members = fetch_project_members(
            session,
            demo.project_id,
        )

        log_info(f"Found {len(project_members)} project members.")

        faulty_project_members = get_faulty_project_members(
            project_members,
        )

        log_info(f"Found {len(faulty_project_members)} faulty project members.")

        remove_faulty_project_members(
            session,
            demo.project_id,
            faulty_project_members,
        )

        log_info(f"Removed {len(faulty_project_members)} faulty project members.")

        new_project_members = get_new_project_members(
            all_users,
            project_members,
        )

        log_info(f"Missing {len(new_project_members)} project members.")

        add_new_members_to_project(
            session,
            demo.project_id,
            new_project_members,
        )

        log_info(f"Added {len(new_project_members)} project members.")
        # -------------

        log_info(f"Done with demo #{i}.")

    log_info("Done with demos.")


@with_rollback()
def remove_users_from_demos(session: Connection) -> None:
    log_info("Cleaning up demos.")

    all_demos = list_all_demos(session)

    for i, demo in enumerate(all_demos):
        log_info(f"Cleaning up demo #{i}.")

        # DEMO PROJECTS
        remove_all_members_from_project(
            session,
            demo.project_id,
        )
        # -------------

        log_info("Removed project members.")

        # DEMO WORKSPACES
        remove_all_members_from_workspace(
            session,
            demo.workspace_id,
        )
        # ---------------

        log_info("Removed workspace members.")

        # DEMO ORGANIZATIONS
        remove_all_members_from_organization(
            session,
            demo.organization_id,
        )
        # ------------------

        log_info("Removed organization members.")

        log_info(f"Done with demo #{i}.")

    log_info("Done with demos.")
