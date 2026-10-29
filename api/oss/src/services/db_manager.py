import os
import uuid
import uuid_utils.compat as uuid_compat
from contextlib import asynccontextmanager
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, NamedTuple, Optional, Set

from fastapi import HTTPException
from sqlalchemy.future import select
from sqlalchemy import delete, func, or_, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import NoResultFound, MultipleResultsFound

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.dbs.postgres.shared.engine import (
    get_transactions_engine,
)
from oss.src.utils.helpers import get_slug_from_name_and_id

from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.workflows.dao import WorkflowsDAO
from oss.src.dbs.postgres.testcases.dbes import TestcaseBlobDBE
from oss.src.dbs.postgres.testsets.dbes import (
    TestsetArtifactDBE,
    TestsetVariantDBE,
    TestsetRevisionDBE,
)
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)

from oss.src.models.db_models import (
    ProjectDB,
)

from oss.src.models.db_models import (
    UserDB,
    APIKeyDB,
    InvitationDB,
    OrganizationDB,
    OrganizationMemberDB,
    ProjectMemberDB,
)
from oss.src.dbs.postgres.webhooks.dbes import WebhookSubscriptionDBE
from oss.src.core.access.permissions.types import (
    Permission,
)
from oss.src.core.access.controls import (
    get_role_description,
    get_role_permissions,
)
from oss.src.core.testcases.dtos import Testcase
from oss.src.core.testsets.dtos import (
    TestsetRevisionData,
    SimpleTestsetCreate,
)


log = get_module_logger(__name__)

# Define parent directory
PARENT_DIRECTORY = Path(os.path.dirname(__file__)).parent


async def fetch_project_by_id(
    project_id: str,
) -> Optional[ProjectDB]:
    engine = get_transactions_engine()
    async with engine.session() as session:
        project = (
            (
                await session.execute(
                    select(ProjectDB).filter_by(
                        id=uuid.UUID(project_id),
                    )
                )
            )
            .scalars()
            .first()
        )

        return project


async def fetch_projects_by_organization(
    organization_id: uuid.UUID,
) -> List[ProjectDB]:
    """Every project of an organization, the default project first."""

    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            select(ProjectDB)
            .filter(ProjectDB.organization_id == organization_id)
            .order_by(
                ProjectDB.is_default.desc().nulls_last(),
                ProjectDB.created_at.asc(),
                ProjectDB.id.asc(),
            )
        )
        return result.scalars().all()


# The organization's default project: an organization has one (oss000000053 and its
# step 2b rerun keep one per organization); `created_at, id` breaks a tie the same way
# every time. Without a default, the organization's first project by the same order.
_ORGANIZATION_PROJECT_ORDER = "p.created_at ASC NULLS LAST, p.id ASC"

# The columns `ProjectDB` maps, named one by one: a wildcard would also read the legacy
# workspace column, which no code reads since workspace removal step 2b.
_PROJECT_COLUMNS = (
    "id, project_name, is_default, organization_id, created_at, updated_at, "
    "deleted_at, created_by_id, updated_by_id, deleted_by_id"
)
_P_PROJECT_COLUMNS = ", ".join(f"p.{c}" for c in _PROJECT_COLUMNS.split(", "))

_PROJECT_BY_ORGANIZATION_SQL = f"""
SELECT {_P_PROJECT_COLUMNS} FROM projects p
WHERE p.organization_id = CAST(:organization_id AS uuid)
ORDER BY (p.is_default IS TRUE) DESC, {_ORGANIZATION_PROJECT_ORDER}
LIMIT 1
"""

_FIRST_PROJECT_BY_ORGANIZATION_SQL = f"""
SELECT {_P_PROJECT_COLUMNS} FROM projects p
WHERE p.organization_id = CAST(:organization_id AS uuid)
ORDER BY {_ORGANIZATION_PROJECT_ORDER}
LIMIT 1
"""

_DEFAULT_PROJECT_SQL = f"""
SELECT p.id AS project_id, p.organization_id AS project_organization_id
FROM projects p
WHERE p.is_default IS TRUE AND p.organization_id = CAST(:organization_id AS uuid)
ORDER BY {_ORGANIZATION_PROJECT_ORDER}
LIMIT 1
"""


class DefaultProjectRef(NamedTuple):
    project_id: uuid.UUID
    project_organization_id: uuid.UUID


async def fetch_default_project(
    *,
    organization_id: str,
) -> Optional[DefaultProjectRef]:
    """The default project of an organization, in one statement. Any other id (a legacy
    workspace id) names no organization: None."""

    ref = uuid.UUID(str(organization_id))
    engine = get_transactions_engine()
    async with engine.session() as session:
        row = (
            await session.execute(text(_DEFAULT_PROJECT_SQL), {"organization_id": ref})
        ).first()
    if row is None:
        return None
    return DefaultProjectRef(
        project_id=row.project_id,
        project_organization_id=row.project_organization_id,
    )


# Among projects the caller may open, the one a request without `project_id` lands on when
# the organization's default project is not one of them: the default first, then the
# organization order.
_MEMBER_FALLBACK_PROJECT_SQL = f"""
SELECT p.id FROM projects p
WHERE p.id = ANY(CAST(:project_ids AS uuid[]))
ORDER BY (p.is_default IS TRUE) DESC, {_ORGANIZATION_PROJECT_ORDER}
LIMIT 1
"""


async def pick_fallback_project(
    *,
    project_ids: List[uuid.UUID],
) -> Optional[uuid.UUID]:
    """The project of `project_ids` a request without `project_id` lands on."""

    if not project_ids:
        return None
    engine = get_transactions_engine()
    async with engine.session() as session:
        row = (
            await session.execute(
                text(_MEMBER_FALLBACK_PROJECT_SQL),
                {"project_ids": [str(project_id) for project_id in project_ids]},
            )
        ).first()
    return row.id if row else None


async def get_project_by_workspace(
    workspace_id: str,
    *,
    use_default: bool = True,
) -> ProjectDB:
    """The (default) project of the organization that `workspace_id` names: the classic
    app sends the organization id where a workspace id was (design D6)."""

    if workspace_id is None:
        raise ValueError("Workspace ID is required to retrieve project")
    ref = uuid.UUID(str(workspace_id))
    engine = get_transactions_engine()

    async with engine.session() as session:
        statement = (
            _PROJECT_BY_ORGANIZATION_SQL
            if use_default
            else _FIRST_PROJECT_BY_ORGANIZATION_SQL
        )
        result = await session.execute(
            select(ProjectDB).from_statement(text(statement)),
            {"organization_id": ref},
        )
        project = result.scalars().first()
        if project is None:
            raise NoResultFound(f"No project with workspace IDs ({workspace_id}) found")
        return project


async def fetch_oldest_organization_id(*, user_id: str) -> Optional[str]:
    """The organization of the user's oldest organization membership."""

    engine = get_transactions_engine()
    async with engine.session() as session:
        organization_id = (
            await session.execute(
                text(
                    "SELECT organization_id FROM organization_members "
                    "WHERE user_id = CAST(:user_id AS uuid) "
                    "ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1"
                ),
                {"user_id": uuid.UUID(str(user_id))},
            )
        ).scalar()
    return str(organization_id) if organization_id is not None else None


async def fetch_organization_by_id(
    organization_id: str,
) -> Optional[OrganizationDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        organization = (
            (
                await session.execute(
                    select(OrganizationDB).filter_by(
                        id=uuid.UUID(organization_id),
                    )
                )
            )
            .scalars()
            .first()
        )

        return organization


async def add_default_simple_testsets(
    *,
    project_id: str,
    user_id: str,
    template_names: Optional[List[str]] = None,
) -> None:
    """Create default simple testsets from bundled presets."""
    from oss.src.core.testcases.service import TestcasesService
    from oss.src.core.testsets.service import TestsetsService, SimpleTestsetsService

    testsets_dir = PARENT_DIRECTORY / "resources" / "default_testsets"
    if not testsets_dir.exists():
        return

    if template_names:
        filenames = [f"{name}_testset.json" for name in template_names]
    else:
        filenames = sorted(path.name for path in testsets_dir.glob("*_testset.json"))

    if not filenames:
        return

    testcases_dao = BlobsDAO(
        BlobDBE=TestcaseBlobDBE,
    )
    testsets_dao = GitDAO(
        ArtifactDBE=TestsetArtifactDBE,
        VariantDBE=TestsetVariantDBE,
        RevisionDBE=TestsetRevisionDBE,
    )
    testcases_service = TestcasesService(
        testcases_dao=testcases_dao,
    )
    testsets_service = TestsetsService(
        testsets_dao=testsets_dao,
        testcases_service=testcases_service,
    )
    simple_testsets_service = SimpleTestsetsService(
        testsets_service=testsets_service,
    )

    project_uuid = uuid.UUID(project_id)
    user_uuid = uuid.UUID(user_id)

    for filename in filenames:
        json_path = testsets_dir / filename
        if not json_path.exists():
            continue

        try:
            testcases_data = None
            with open(str(json_path)) as f:
                try:
                    testcases_data = json.loads(f.read())
                except json.JSONDecodeError as e:
                    raise ValueError(f"Could not parse JSON file: {json_path}") from e
                except Exception as e:
                    raise ValueError(f"Could not read JSON file: {json_path}") from e

            if not isinstance(testcases_data, list):
                raise ValueError("Default testset must be a JSON array")

            testcases = [Testcase(data=testcase) for testcase in testcases_data]
            testset_revision_data = TestsetRevisionData(testcases=testcases)

            testset_name = filename.replace("_testset.json", "_testset")
            testset_slug = get_slug_from_name_and_id(testset_name, uuid.uuid4())

            simple_testset_create = SimpleTestsetCreate(
                slug=testset_slug,
                name=testset_name,
                data=testset_revision_data,
            )

            await simple_testsets_service.create(
                project_id=project_uuid,
                user_id=user_uuid,
                simple_testset_create=simple_testset_create,
            )
        except Exception:
            log.error(
                "An error occurred in adding a default simple testset",
                template_file=filename,
                exc_info=True,
            )


async def add_default_simple_evaluators(
    *,
    project_id: str,
    user_id: str,
) -> None:
    """Create default simple evaluators for direct-use evaluator types."""
    from oss.src.core.workflows.service import WorkflowsService
    from oss.src.core.evaluators.service import (
        EvaluatorsService,
        SimpleEvaluatorsService,
    )
    from oss.src.core.evaluators.dtos import (
        SimpleEvaluatorCreate,
        SimpleEvaluatorFlags,
    )
    from oss.src.core.evaluators.utils import build_evaluator_data
    from oss.src.resources.evaluators.evaluators import get_builtin_evaluators

    BUILTIN_EVALUATORS = get_builtin_evaluators()

    workflows_dao = WorkflowsDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    )
    workflows_service = WorkflowsService(
        workflows_dao=workflows_dao,
    )
    evaluators_service = EvaluatorsService(
        workflows_service=workflows_service,
    )
    simple_evaluators_service = SimpleEvaluatorsService(
        evaluators_service=evaluators_service,
    )

    project_uuid = uuid.UUID(project_id)
    user_uuid = uuid.UUID(user_id)

    # Get builtin evaluators that are marked for direct use
    direct_use_evaluators = [e for e in BUILTIN_EVALUATORS if e.direct_use]

    for evaluator in direct_use_evaluators:
        try:
            # Extract runtime defaults from the evaluator settings template.
            settings_values = {
                setting_name: setting.get("default")
                for setting_name, setting in evaluator.settings_template.items()
                if isinstance(setting, dict) and setting.get("default") is not None
            }

            # Generate slug from name
            evaluator_slug = get_slug_from_name_and_id(evaluator.name, uuid.uuid4())

            simple_evaluator_create = SimpleEvaluatorCreate(
                slug=evaluator_slug,
                name=evaluator.name,
                flags=SimpleEvaluatorFlags(is_evaluator=True),
                data=build_evaluator_data(
                    evaluator_key=evaluator.key,
                    settings_values=settings_values if settings_values else None,
                ),
            )

            await simple_evaluators_service.create(
                project_id=project_uuid,
                user_id=user_uuid,
                simple_evaluator_create=simple_evaluator_create,
            )
        except Exception:
            log.error(
                "An error occurred in adding a default simple evaluator",
                evaluator_name=evaluator.name,
                exc_info=True,
            )


async def get_user(user_uid: str) -> UserDB:
    """Get the user object from the database.

    Arguments:
        user_id (str): The user unique identifier

    Returns:
        UserDB: instance of user
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        # NOTE: Backward Compatibility
        # ---------------------------
        # Previously, the user_id field in the api_keys collection in MongoDB used the
        # session_id from SuperTokens in Cloud and  "0" as the uid in OSS.
        # During migration, we changed this to use the actual user ID. Therefore, we have two checks:
        # 1. Check if user_uid is found in the UserDB.uid column.
        # 2. If not found, check if user_uid is found in the UserDB.id column.
        conditions = [UserDB.uid == user_uid]
        try:
            conditions.append(UserDB.id == uuid.UUID(user_uid))
        except ValueError:
            # user_uid is a SuperTokens uid, not a UUID — match on uid only.
            pass

        result = await session.execute(select(UserDB).where(or_(*conditions)))
        user = result.scalars().first()

        return user


async def create_organization(
    name: str,
    owner_id: Optional[uuid.UUID] = None,
    created_by_id: Optional[uuid.UUID] = None,
):
    """Create a new organization in the database (slug stays NULL; one org
    per signup in both editions)."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        # For bootstrap scenario, use a placeholder UUID if not provided
        _owner_id = owner_id or uuid.uuid4()
        _created_by_id = created_by_id or _owner_id
        flags = {
            "is_demo": False,
            "allow_email": env.auth.email_enabled,
            "allow_social": env.auth.oidc_enabled,
            "allow_sso": False,
            "allow_root": False,
            "domains_only": False,
            "auto_join": False,
        }

        organization_db = OrganizationDB(
            name=name,
            flags=flags,
            owner_id=_owner_id,
            created_by_id=_created_by_id,
        )

        session.add(organization_db)

        await session.commit()

        log.info(
            "[scopes] organization created",
            organization_id=organization_db.id,
        )

        return organization_db


async def update_organization(organization_id: str, values_to_update: Dict[str, Any]):
    """
    Update the specified organization in the database.

    Args:
        organization_id (str): The ID of the organization
        values_to_update (Dict[str, Any]): The values to update in the organization
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalar()
        if organization is None:
            raise Exception(f"Organization with ID {organization_id} not found")

        # Validate slug immutability: once set, cannot be changed
        if "slug" in values_to_update:
            new_slug = values_to_update["slug"]
            if organization.slug is not None and new_slug != organization.slug:
                raise ValueError(
                    f"Organization slug cannot be changed once set. "
                    f"Current slug: '{organization.slug}'"
                )

        for key, value in values_to_update.items():
            if hasattr(organization, key):
                setattr(organization, key, value)

        await session.commit()
        await session.refresh(organization)

        return organization


async def get_organizations() -> List[OrganizationDB]:
    """
    Retrieve organizations from the database by their IDs.

    Returns:
        List: A list of organizations.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(OrganizationDB))
        organizations = result.scalars().all()
        return organizations


async def get_organization_by_id(organization_id: str) -> OrganizationDB:
    """
    Retrieve an organization from the database by its ID.

    Args:
        organization_id (str): The ID of the organization

    Returns:
        OrganizationDB: The organization object if found, None otherwise.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalar()
        return organization


async def get_organization_by_slug(organization_slug: str) -> OrganizationDB:
    """
    Retrieve an organization from the database by its slug.

    Args:
        organization_slug (str): The slug of the organization

    Returns:
        OrganizationDB: The organization object if found, None otherwise.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(slug=organization_slug)
        )
        organization = result.scalar()
        return organization


async def get_organization_owner(organization_id: str):
    """
    Retrieve the owner of an organization from the database by its ID.

    Args:
        organization_id (str): The ID of the organization

    Returns:
        UserDB: The owner of the organization if found, None otherwise.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalar()
        if organization is None:
            raise NoResultFound(f"Organization with ID {organization_id} not found")

        return await get_user_with_id(user_id=str(organization.owner_id))


async def get_user_organizations(user_id: str) -> List[OrganizationDB]:
    """
    Retrieve all organizations that a user is a member of.

    Args:
        user_id (str): The ID of the user

    Returns:
        List[OrganizationDB]: List of organizations the user belongs to
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB)
            .join(
                OrganizationMemberDB,
                OrganizationDB.id == OrganizationMemberDB.organization_id,
            )
            .filter(OrganizationMemberDB.user_id == uuid.UUID(user_id))
        )
        organizations = result.scalars().all()
        return list(organizations)


async def count_organizations_by_owner(owner_id: str) -> int:
    """Count the number of organizations owned by a user."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(func.count(OrganizationDB.id)).where(
                OrganizationDB.owner_id == uuid.UUID(owner_id)
            )
        )
        return result.scalar() or 0


async def count_organization_projects(organization_id: str) -> int:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(func.count(ProjectDB.id)).where(
                ProjectDB.organization_id == uuid.UUID(organization_id)
            )
        )
        return result.scalar() or 0


async def delete_organization(organization_id: str) -> bool:
    """Delete an organization and all its related data (FK cascades)."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalars().first()

        if not organization:
            raise NoResultFound(f"Organization with id {organization_id} not found")

        await session.execute(
            delete(OrganizationDB).where(OrganizationDB.id == organization.id)
        )
        await session.commit()
        return True


async def get_user_with_id(user_id: str) -> UserDB:
    """
    Retrieves a user from a database based on their ID.

    Args:
        user_id (str): The ID of the user to retrieve from the database.

    Returns:
        user: The user object retrieved from the database.

    Raises:
        Exception: If an error occurs while getting the user from the database.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(UserDB).filter_by(id=uuid.UUID(user_id)))
        user = result.scalars().first()
        if user is None:
            log.error("Failed to get user with id")
            raise NoResultFound(f"User with id {user_id} not found")
        return user


async def update_user_username(user_id: str, username: str) -> UserDB:
    """Update a user's username."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(UserDB).filter_by(id=uuid.UUID(user_id)))
        user = result.scalars().first()
        if user is None:
            log.error("Failed to get user with id for username update")
            raise NoResultFound(f"User with id {user_id} not found")

        user.username = username
        user.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(user)
        return user


async def get_user_with_email(email: str):
    """
    Retrieves a user from the database based on their email address.

    Args:
        email (str): The email address of the user to retrieve.

    Returns:
        UserDB: The user object retrieved from the database.

    Raises:
        Exception: If a valid email address is not provided.
        Exception: If an error occurs while retrieving the user.

    Example Usage:
        user = await get_user_with_email('example@example.com')
    """

    if "@" not in email:
        raise Exception("Please provide a valid email address")

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(UserDB).filter_by(email=email))
        user = result.scalars().first()
        return user


async def create_user_invitation_to_organization(
    project_id: str,
    token: str,
    role: str,
    email: str,
    expiration_date: datetime,
):
    """
    Create an organization invitation to a user.

    Args:
        project_id (str): The ID of the project.
        token (str): The token for the invitation.
        role (str): The role of the invitation.
        expiration_date: The expiration date of the invitation.

    Returns:
        InvitationDB: Returns the invitation db object

    Raises:
        Exception: If there is an error updating the user's roles.
    """

    user = await get_user_with_email(email=email)

    user_id = user.id if user else None

    project = await fetch_project_by_id(project_id=project_id)

    if not project:
        raise NoResultFound(f"Project with ID {project_id} not found")

    engine = get_transactions_engine()

    async with engine.session() as session:
        invitation = InvitationDB(
            token=token,
            email=email,
            role=role,
            project_id=uuid.UUID(project_id),
            expiration_date=expiration_date,
        )

        session.add(invitation)

        log.info(
            "[scopes] invitation created",
            organization_id=project.organization_id,
            project_id=project_id,
            user_id=user_id,
            invitation_id=invitation.id,
        )

        await session.commit()

        return invitation


async def get_project_by_id(project_id: str) -> ProjectDB:
    """
    Get the project from database using provided id.

    Args:
        project_id (str): The ID of the project to retrieve.

    Returns:
        str: The retrieve project or None
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        project_query = await session.execute(
            select(ProjectDB)
            .options(joinedload(ProjectDB.organization).load_only(OrganizationDB.name))
            .where(ProjectDB.id == uuid.UUID(project_id))
        )
        project = project_query.scalar()

        return project


async def get_default_project_id_from_workspace(
    workspace_id: str,
):
    """The default project id of the organization that `workspace_id` names (one
    statement).

    Raises `NoResultFound` when there is none.
    """

    ref = await fetch_default_project(organization_id=workspace_id)
    if ref is None:
        raise NoResultFound(
            f"No default project for the provided workspace_id {workspace_id} found"
        )
    return str(ref.project_id)


async def delete_project(project_id: str) -> None:
    """
    Delete a project if it is not the default one.

    Args:
        project_id (str): Identifier of project to delete.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        project = await session.get(ProjectDB, uuid.UUID(project_id))
        if project is None:
            raise NoResultFound(f"Project with ID {project_id} not found")

        if project.is_default:
            raise ValueError("Default project cannot be deleted")

        # this should cascade delete all related entities
        await session.delete(project)
        await session.commit()

        log.info(
            "[scopes] project deleted",
            organization_id=str(project.organization_id),
            project_id=project_id,
        )


# Every default-project writer (and revision oss000000053) takes this lock as the first
# statement of its transaction, then decides in a later statement, so two writers for one
# organization never both see "no other default" or clear each other's choice.
_PROJECT_DEFAULT_LOCK_SQL = """
SELECT pg_advisory_xact_lock(
    hashtextextended('agenta:project_default:' || CAST(:organization_id AS text), 0)
)
"""

_LOCK_PROJECT_ORGANIZATION_SQL = """
SELECT pg_advisory_xact_lock(
    hashtextextended('agenta:project_default:' || p.organization_id::text, 0)
), p.organization_id
FROM projects p WHERE p.id = :id
"""

_SET_DEFAULT_PROJECT_SQL = f"""
WITH cleared AS (
    UPDATE projects SET is_default = false
    WHERE organization_id = :organization_id AND is_default IS TRUE AND id <> :id
)
UPDATE projects SET is_default = true WHERE id = :id
RETURNING {_PROJECT_COLUMNS}
"""


async def set_default_project(project_id: str) -> ProjectDB:
    """Make the project the organization's one default. The organization lock comes
    first, so two writers cannot both see "no other default"."""

    project_uuid = uuid.UUID(project_id)
    engine = get_transactions_engine()

    async with engine.session() as session:
        locked = (
            await session.execute(
                text(_LOCK_PROJECT_ORGANIZATION_SQL), {"id": project_uuid}
            )
        ).first()
        if locked is None:
            raise NoResultFound(f"Project with ID {project_id} not found")

        result = await session.execute(
            select(ProjectDB)
            .from_statement(text(_SET_DEFAULT_PROJECT_SQL))
            .execution_options(populate_existing=True),
            {"id": project_uuid, "organization_id": locked.organization_id},
        )
        project = result.scalars().one()
        await session.commit()

        log.info(
            "[scopes] project set as default",
            organization_id=str(project.organization_id),
            project_id=project_id,
        )

        return project


async def update_project_name(project_id: str, *, project_name: str) -> ProjectDB:
    """
    Update the project's name.

    Args:
        project_id (str): Identifier of project to update.
        project_name (str): New name for the project.
    """

    if not project_name.strip():
        raise ValueError("Project name cannot be empty")

    engine = get_transactions_engine()

    async with engine.session() as session:
        project = await session.get(ProjectDB, uuid.UUID(project_id))
        if project is None:
            raise NoResultFound(f"Project with ID {project_id} not found")

        project.project_name = project_name.strip()
        await session.commit()
        await session.refresh(project)

        log.info(
            "[scopes] project renamed",
            organization_id=str(project.organization_id),
            project_id=project_id,
            project_name=project.project_name,
        )

        return project


async def get_project_invitation_by_email(project_id: str, email: str) -> InvitationDB:
    """Get project invitation by project ID and email.

    Args:
        project_id (str): The ID of the project.
        email (str): The email address of the invited user.

    Returns:
        InvitationDB: invitation object
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), email=email
            )
        )
        invitation = result.scalars().first()
        return invitation


async def get_project_invitation_by_organization_and_email(
    organization_id: str,
    email: str,
) -> Optional[InvitationDB]:
    """Get an invitation by organization and email, regardless of project."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB)
            .join(ProjectDB, InvitationDB.project_id == ProjectDB.id)
            .where(
                ProjectDB.organization_id == uuid.UUID(organization_id),
                InvitationDB.email == email,
            )
            .order_by(InvitationDB.used.asc(), InvitationDB.created_at.desc())
        )
        return result.scalars().first()


async def get_project_invitations(project_id: str) -> InvitationDB:
    """Get project invitations.

    Args:
        project_id (str): The ID of the project.

    Returns:
        List[InvitationDB]: invitation objects
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(project_id=uuid.UUID(project_id))
        )
        invitation = result.scalars().all()
        return invitation


async def update_invitation(invitation_id: str, values_to_update: dict) -> bool:
    """
    Update an invitation from an organization.

    Args:
        invitation (str): The invitation to delete.
        values_to_update (dict): The values to update in the invitation.

    Returns:
        bool: True if the invitation was successfully updated, False otherwise.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(id=uuid.UUID(invitation_id))
        )

        try:
            invitation = result.scalars().one_or_none()
            if invitation is None:
                raise NoResultFound(f"Invitation with ID {invitation_id} not found")
            for key, value in values_to_update.items():
                if hasattr(invitation, key):
                    setattr(invitation, key, value)

        except MultipleResultsFound as e:
            log.error(
                f"Critical error: Database returned two rows when retrieving invitation with ID {invitation_id} to delete from Invitations table",
                exc_info=True,
            )
            raise HTTPException(
                500,
                {
                    "message": f"Error occurred while trying to delete invitation with ID {invitation_id} from Invitations table. Error details: {str(e)}"
                },
            )

        await session.commit()

        return True


async def delete_invitation(invitation_id: str) -> bool:
    """
    Delete an invitation from an organization.

    Args:
        invitation (str): The invitation to delete.

    Returns:
        bool: True if the invitation was successfully deleted, False otherwise.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(id=uuid.UUID(invitation_id))
        )

        try:
            invitation = result.scalars().one_or_none()
            if invitation is None:
                raise NoResultFound(f"Invitation with ID {invitation_id} not found")
        except MultipleResultsFound as e:
            log.error(
                f"Critical error: Database returned two rows when retrieving invitation with ID {invitation_id} to delete from Invitations table.",
                exc_info=True,
            )
            raise HTTPException(
                500,
                {
                    "message": f"Error occurred while trying to delete invitation with ID {invitation_id} from Invitations table. Error details: {str(e)}"
                },
            )

        project = await fetch_project_by_id(project_id=str(invitation.project_id))

        if not project:
            raise NoResultFound(f"Project with ID {invitation.project_id} not found")

        await session.delete(invitation)

        log.info(
            "[scopes] invitation deleted",
            organization_id=project.organization_id,
            project_id=invitation.project_id,
            user_id=invitation.user_id,
            invitation_id=invitation.id,
        )

        await session.commit()

        return True


async def get_project_invitation_by_token_and_email(
    project_id: str, token: str, email: str
) -> InvitationDB:
    """Get project invitation by project ID, token and email.

    Args:
        project_id (str): The ID of the project.
        token (str): The invitation token.
        email (str): The email address of the invited user.

    Returns:
        InvitationDB: invitation object
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), token=token, email=email
            )
        )
        invitation = result.scalars().first()
        return invitation


async def get_project_invitation_by_token(
    project_id: str, token: str
) -> Optional[InvitationDB]:
    """Get a project invitation by project ID and token alone.

    The token is effectively unique, so this resolves the invitation without
    knowing the addressee, which lets callers compare the invite's email to the
    signed-in user before any further check.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), token=token
            )
        )
        return result.scalars().first()


async def get_project_invitation_by_organization_token_and_email(
    organization_id: str,
    token: str,
    email: str,
) -> Optional[InvitationDB]:
    """Get an invitation by organization, token, and email, regardless of project."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB)
            .join(ProjectDB, InvitationDB.project_id == ProjectDB.id)
            .where(
                ProjectDB.organization_id == uuid.UUID(organization_id),
                InvitationDB.token == token,
                InvitationDB.email == email,
            )
        )
        return result.scalars().first()


async def get_user_api_key_by_prefix(
    api_key_prefix: str, user_id: str
) -> Optional[APIKeyDB]:
    """
    Gets the user api key by prefix.

    Args:
        api_key_prefix (str): The prefix of the api key
        user_uid (str): The unique ID of the user

    Returns:
        The user api key by prefix.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(APIKeyDB).filter_by(
                prefix=api_key_prefix, created_by_id=uuid.UUID(user_id)
            )
        )
        api_key = result.scalars().first()
        return api_key


# ---------------------------------------------------------------------------
# Platform Admin helpers
# ---------------------------------------------------------------------------


async def admin_get_user_by_id(user_id: uuid.UUID) -> Optional[UserDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(UserDB).filter_by(id=user_id))
        return result.scalars().first()


async def admin_get_user_by_email(email: str) -> Optional[UserDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(UserDB).filter_by(email=email))
        return result.scalars().first()


async def admin_get_org_by_id(org_id: uuid.UUID) -> Optional[OrganizationDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(OrganizationDB).filter_by(id=org_id))
        return result.scalars().first()


async def admin_get_org_by_slug(slug: str) -> Optional[OrganizationDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(OrganizationDB).filter_by(slug=slug))
        return result.scalars().first()


async def admin_get_project_by_id(proj_id: uuid.UUID) -> Optional[ProjectDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(ProjectDB).filter_by(id=proj_id))
        return result.scalars().first()


async def admin_get_api_key_by_id(key_id: uuid.UUID) -> Optional[APIKeyDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(APIKeyDB).filter_by(id=key_id))
        return result.scalars().first()


async def admin_get_api_key_by_prefix(prefix: str) -> Optional[APIKeyDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(APIKeyDB).filter_by(prefix=prefix))
        return result.scalars().first()


async def admin_get_orgs_owned_by_user(user_id: uuid.UUID) -> List[OrganizationDB]:
    """Return orgs where user is owner OR creator (both carry RESTRICT FK)."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).where(
                or_(
                    OrganizationDB.owner_id == user_id,
                    OrganizationDB.created_by_id == user_id,
                )
            )
        )
        return list(result.scalars().all())


async def admin_get_project_ids_for_orgs(
    org_ids: List[uuid.UUID],
) -> List[uuid.UUID]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(ProjectDB.id).where(ProjectDB.organization_id.in_(org_ids))
        )
        return [row[0] for row in result]


async def admin_get_or_create_user(
    email: str,
    username: Optional[str] = None,
) -> UserDB:
    existing = await admin_get_user_by_email(email)
    if existing:
        return existing
    engine = get_transactions_engine()

    async with engine.session() as session:
        user_db = UserDB(
            uid=str(uuid.uuid4()),
            username=username or email.split("@")[0],
            email=email,
        )
        session.add(user_db)
        await session.commit()
        await session.refresh(user_db)
        log.info("[admin] user created", user_id=str(user_db.id))
        return user_db


async def admin_create_organization(
    name: str,
    slug: Optional[str],
    owner_id: uuid.UUID,
) -> OrganizationDB:
    """Create an organization with the supplied name/slug (admin path)."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        org_db = OrganizationDB(
            name=name,
            slug=slug,
            flags={"is_demo": False},
            owner_id=owner_id,
            created_by_id=owner_id,
        )
        session.add(org_db)
        await session.commit()
        await session.refresh(org_db)
        log.info("[admin] organization created", organization_id=str(org_db.id))
        return org_db


_ADMIN_INSERT_PROJECT_SQL = f"""
WITH cleared AS (
    UPDATE projects SET is_default = false
    WHERE organization_id = :organization_id AND is_default IS TRUE
      AND CAST(:is_default AS boolean)
)
INSERT INTO projects (id, project_name, is_default, organization_id,
                      created_at, updated_at)
VALUES (:id, :name, :is_default, :organization_id, now(), now())
RETURNING {_PROJECT_COLUMNS}
"""


async def admin_create_project(
    name: str,
    org_id: uuid.UUID,
    *,
    is_default: bool = False,
) -> ProjectDB:
    """Create a project of the organization; `is_default` clears the organization's
    other defaults, under the organization lock."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(
            text(_PROJECT_DEFAULT_LOCK_SQL), {"organization_id": str(org_id)}
        )
        result = await session.execute(
            select(ProjectDB).from_statement(text(_ADMIN_INSERT_PROJECT_SQL)),
            {
                "id": uuid_compat.uuid7(),
                "name": name,
                "is_default": bool(is_default),
                "organization_id": org_id,
            },
        )
        proj_db = result.scalars().one()
        await session.commit()
        log.info("[admin] project created", project_id=str(proj_db.id))
        return proj_db


async def admin_delete_user(user_id: uuid.UUID) -> None:
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(delete(UserDB).where(UserDB.id == user_id))
        await session.commit()


async def admin_delete_organization(org_id: uuid.UUID) -> None:
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(delete(OrganizationDB).where(OrganizationDB.id == org_id))
        await session.commit()


async def admin_delete_project(proj_id: uuid.UUID) -> None:
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(delete(ProjectDB).where(ProjectDB.id == proj_id))
        await session.commit()


async def admin_delete_api_key(key_id: uuid.UUID) -> None:
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(delete(APIKeyDB).where(APIKeyDB.id == key_id))
        await session.commit()


async def _admin_detach_user_references(
    session: AsyncSession,
    user_ids: List[uuid.UUID],
) -> None:
    """Clear references to users from rows that survive the account cascade.

    A user leaves traces in organizations they do not own (an accepted
    invitation, audit columns on variants/revisions they edited, webhook
    subscriptions they created). Those organizations are not deleted with the
    user, so the rows survive and their NO ACTION foreign keys block
    `DELETE FROM users`.
    """
    if not user_ids:
        return

    await session.execute(
        delete(InvitationDB).where(InvitationDB.user_id.in_(user_ids))
    )
    # created_by_id is NOT NULL, so the rows cannot be detached.
    await session.execute(
        delete(WebhookSubscriptionDBE).where(
            WebhookSubscriptionDBE.created_by_id.in_(user_ids)
        )
    )


async def admin_delete_accounts_batch(
    *,
    org_ids: List[uuid.UUID],
    project_ids: List[uuid.UUID],
    user_ids: List[uuid.UUID],
) -> None:
    """Delete a batch of entities atomically, in dependency order."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        for proj_id in project_ids:
            await session.execute(delete(ProjectDB).where(ProjectDB.id == proj_id))
        for org_id in org_ids:
            await session.execute(
                delete(OrganizationDB).where(OrganizationDB.id == org_id)
            )
        await _admin_detach_user_references(session, user_ids)
        for uid in user_ids:
            await session.execute(delete(UserDB).where(UserDB.id == uid))
        await session.commit()


async def admin_delete_user_with_cascade(user_id: uuid.UUID) -> List[uuid.UUID]:
    """Delete a user together with all orgs they own or created.

    Returns the list of deleted org IDs.
    """
    orgs = await admin_get_orgs_owned_by_user(user_id)
    org_ids = [org.id for org in orgs]
    await admin_delete_accounts_batch(
        org_ids=org_ids,
        project_ids=[],
        user_ids=[user_id],
    )
    return org_ids


@asynccontextmanager
async def _admin_session(session: Optional[AsyncSession]):
    """The caller's session (the caller commits), or a new one committed on exit."""
    if session is not None:
        yield session
        return
    async with get_transactions_engine().session() as own:
        yield own
        await own.commit()


async def admin_transfer_org_ownership_batch(
    org_ids: List[uuid.UUID],
    target_id: uuid.UUID,
    *,
    session: Optional[AsyncSession] = None,
) -> None:
    """Update owner_id and created_by_id on multiple orgs.

    Both columns carry a RESTRICT FK to users.id at the DB level.
    Transferring created_by_id alongside owner_id ensures the source
    user has no remaining FK references, so a subsequent cascade delete
    of that user does not destroy orgs now owned by the target.
    """
    now = datetime.now(timezone.utc)
    async with _admin_session(session) as session:
        for org_id in org_ids:
            await session.execute(
                update(OrganizationDB)
                .where(OrganizationDB.id == org_id)
                .values(
                    owner_id=target_id,
                    created_by_id=target_id,
                    updated_at=now,
                    updated_by_id=target_id,
                )
            )


# ---------------------------------------------------------------------------
# RBAC lookups (relational reads used by access enforcement)
# ---------------------------------------------------------------------------


async def get_organization(organization_id: str) -> OrganizationDB:
    """Fetch an organization by its ID."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalars().first()
        return organization


async def get_project_members(project_id: str):
    """Get the members of a project."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        members_query = await session.execute(
            select(ProjectMemberDB)
            .filter(ProjectMemberDB.project_id == uuid.UUID(project_id))
            .options(joinedload(ProjectMemberDB.user))
        )
        project_members = members_query.scalars().all()
        return project_members


# ---------------------------------------------------------------------------
# Organization / workspace helpers (moved from ee/services/db_manager_ee.py)
# ---------------------------------------------------------------------------


async def get_organizations_by_list_ids(organization_ids: List) -> List[OrganizationDB]:
    """Retrieve organizations from the database by their IDs."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        organization_uuids = [
            uuid.UUID(organization_id) for organization_id in organization_ids
        ]
        query = select(OrganizationDB).where(OrganizationDB.id.in_(organization_uuids))
        result = await session.execute(query)
        organizations = result.scalars().all()
        return organizations


async def count_organization_members(organization_id: str) -> int:
    """Count the number of members in an organization."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(func.count(OrganizationMemberDB.id)).where(
                OrganizationMemberDB.organization_id == uuid.UUID(organization_id)
            )
        )
        return result.scalar() or 0


# The project whose members `GET /organizations/{id}` lists: the organization's default
# project, else its first project (the reader rule). One statement.
_ORG_DETAILS_PROJECT_SQL = _PROJECT_BY_ORGANIZATION_SQL

# The project's members with their organization role (the oldest organization row), and
# their user, in one statement.
_ORG_DETAILS_MEMBERS_SQL = """
SELECT u.id, u.email, u.username, u.created_at, om.role
FROM project_members pm
JOIN users u ON u.id = pm.user_id
LEFT JOIN LATERAL (
    SELECT role FROM organization_members
    WHERE organization_id = :organization_id AND user_id = pm.user_id
    ORDER BY created_at ASC NULLS LAST, id ASC
    LIMIT 1
) om ON true
WHERE pm.project_id = :project_id
"""


async def fetch_org_details_project(organization_id: str) -> Optional[ProjectDB]:
    """The project whose members the organization details list (one statement)."""

    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            select(ProjectDB).from_statement(text(_ORG_DETAILS_PROJECT_SQL)),
            {"organization_id": str(uuid.UUID(str(organization_id)))},
        )
        return result.scalars().first()


async def get_org_details(organization) -> dict:
    """The organization details, with the organization where the default workspace
    goes (workspace removal step 2, design D6): its members are those of the project
    step 1 listed, with their organization role, plus the pending invitations."""

    from oss.src.models.api.workspace_models import WorkspaceResponse

    is_demo = organization.flags.get("is_demo", False) if organization.flags else False

    project = await fetch_org_details_project(str(organization.id))
    # Design D6: the organization is the default workspace, also without a project (then
    # with no members).
    members = (
        await _org_details_members(organization, project)
        if project is not None and not is_demo
        else []
    )
    default_workspace = WorkspaceResponse(
        id=str(organization.id),
        name=organization.name or "",
        description=organization.description,
        type="default",
        members=members,
        organization=str(organization.id),
        created_at=str(organization.created_at),
        updated_at=str(organization.updated_at),
    ).model_dump(mode="json")

    return {
        "id": str(organization.id),
        "slug": organization.slug,
        "name": organization.name,
        "description": organization.description,
        "flags": organization.flags,
        "tags": organization.tags,
        "meta": organization.meta,
        "owner_id": str(organization.owner_id),
        "workspaces": [str(organization.id)],
        "default_workspace": default_workspace,
    }


async def _org_details_members(organization, project) -> List[dict]:
    members = []

    # Pending invitations of every project of the organization: invitations go to the
    # organization's default project, which may not be the project listed here (one per
    # email, the newest).
    invitations = await fetch_pending_organization_invitations(organization.id)
    for invitation in invitations:
        user = await get_user_with_email(invitation.email)
        members.append(
            {
                "user": {
                    "id": str(user.id) if user else invitation.email,
                    "email": user.email if user else invitation.email,
                    "username": (
                        user.username if user else invitation.email.split("@")[0]
                    ),
                    "status": (
                        "pending"
                        if invitation.expiration_date > datetime.now(timezone.utc)
                        else "expired"
                    ),
                    "created_at": (
                        str(user.created_at)
                        if user
                        else (
                            str(invitation.created_at)
                            if str(invitation.created_at)
                            else None
                        )
                    ),
                },
                "roles": [
                    {
                        "role_name": invitation.role,
                        "role_description": get_role_description(
                            "workspace", _role_slug(invitation.role)
                        ),
                    }
                ],
            }
        )

    engine = get_transactions_engine()
    async with engine.session() as session:
        rows = (
            await session.execute(
                text(_ORG_DETAILS_MEMBERS_SQL),
                {"organization_id": organization.id, "project_id": project.id},
            )
        ).all()
    for row in rows:
        members.append(
            {
                "user": {
                    "id": str(row.id),
                    "email": row.email,
                    "username": row.username,
                    "status": "member",
                    "created_at": str(row.created_at),
                },
                "roles": (
                    [
                        {
                            "role_name": row.role,
                            "role_description": get_role_description(
                                "organization", _role_slug(row.role)
                            ),
                            "permissions": _expand_permissions(
                                get_role_permissions(
                                    "organization", _role_slug(row.role)
                                )
                            ),
                        }
                    ]
                    if row.role
                    else []
                ),
            }
        )
    return members


async def fetch_pending_organization_invitations(organization_id) -> List[InvitationDB]:
    """The unused invitations of the organization's projects, the newest per email."""

    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB)
            .join(ProjectDB, ProjectDB.id == InvitationDB.project_id)
            .filter(
                ProjectDB.organization_id == uuid.UUID(str(organization_id)),
                InvitationDB.used.is_not(True),
            )
            .order_by(InvitationDB.created_at.desc(), InvitationDB.id.desc())
        )
        invitations, emails = [], set()
        for invitation in result.scalars().all():
            if invitation.email in emails:
                continue
            emails.add(invitation.email)
            invitations.append(invitation)
        return invitations


# ---------------------------------------------------------------------------
# Platform Admin helpers
# ---------------------------------------------------------------------------


async def admin_delete_org_membership(membership_id: uuid.UUID) -> bool:
    """Delete an org membership by ID. Returns False if not found."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationMemberDB).filter_by(id=membership_id)
        )
        membership = result.scalars().first()
        if not membership:
            return False
        await session.delete(membership)
        await session.commit()
        return True


async def admin_delete_project_membership(membership_id: uuid.UUID) -> bool:
    """Delete a project membership by ID. Returns False if not found."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(ProjectMemberDB).filter_by(id=membership_id)
        )
        membership = result.scalars().first()
        if not membership:
            return False
        await session.delete(membership)
        await session.commit()
        return True


async def admin_get_member_org_ids(
    user_id: uuid.UUID,
    org_ids: List[uuid.UUID],
) -> Set[uuid.UUID]:
    """Return the subset of org_ids where the user has a membership row."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB.organization_id).where(
                        OrganizationMemberDB.user_id == user_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        return set(rows)


async def admin_swap_org_memberships(
    org_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
    *,
    session: Optional[AsyncSession] = None,
) -> None:
    """Swap org membership roles between source and target."""
    async with _admin_session(session) as session:
        source_rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB).where(
                        OrganizationMemberDB.user_id == source_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        target_rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB).where(
                        OrganizationMemberDB.user_id == target_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        source_by_org = {row.organization_id: row.role for row in source_rows}
        target_by_org = {row.organization_id: row.role for row in target_rows}

        for org_id in set(source_by_org) & set(target_by_org):
            await session.execute(
                update(OrganizationMemberDB)
                .where(
                    OrganizationMemberDB.user_id == target_id,
                    OrganizationMemberDB.organization_id == org_id,
                )
                .values(role=source_by_org[org_id])
            )
            await session.execute(
                update(OrganizationMemberDB)
                .where(
                    OrganizationMemberDB.user_id == source_id,
                    OrganizationMemberDB.organization_id == org_id,
                )
                .values(role=target_by_org[org_id])
            )


async def admin_swap_project_memberships(
    project_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
    *,
    session: Optional[AsyncSession] = None,
) -> None:
    """Swap project membership roles between source and target."""
    async with _admin_session(session) as session:
        source_rows = (
            (
                await session.execute(
                    select(ProjectMemberDB).where(
                        ProjectMemberDB.user_id == source_id,
                        ProjectMemberDB.project_id.in_(project_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        target_rows = (
            (
                await session.execute(
                    select(ProjectMemberDB).where(
                        ProjectMemberDB.user_id == target_id,
                        ProjectMemberDB.project_id.in_(project_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        source_by_proj = {row.project_id: row.role for row in source_rows}
        target_by_proj = {row.project_id: row.role for row in target_rows}

        for proj_id in set(source_by_proj) & set(target_by_proj):
            await session.execute(
                update(ProjectMemberDB)
                .where(
                    ProjectMemberDB.user_id == target_id,
                    ProjectMemberDB.project_id == proj_id,
                )
                .values(role=source_by_proj[proj_id])
            )
            await session.execute(
                update(ProjectMemberDB)
                .where(
                    ProjectMemberDB.user_id == source_id,
                    ProjectMemberDB.project_id == proj_id,
                )
                .values(role=target_by_proj[proj_id])
            )


async def admin_seed_owner_project_rows(
    org_ids: List[uuid.UUID],
    owner_id: uuid.UUID,
    *,
    session: Optional[AsyncSession] = None,
) -> int:
    """Add an `owner` project row for `owner_id` in every project of `org_ids` where
    the user has none; existing rows keep their roles.

    The membership resolver checks membership before the organization owner
    shortcut, so an EE owner without a project row would be denied in that project.
    `MembershipsService.transfer_ownership` seeds the same rows.
    """
    if not org_ids:
        return 0

    async with _admin_session(session) as session:
        result = await session.execute(
            text(
                "INSERT INTO project_members "
                "(id, user_id, project_id, role, created_at, updated_at) "
                "SELECT gen_random_uuid(), :owner_id, p.id, 'owner', now(), now() "
                "FROM projects p "
                "WHERE p.organization_id = ANY(CAST(:org_ids AS uuid[])) "
                "ON CONFLICT (project_id, user_id) DO NOTHING"
            ),
            {"owner_id": owner_id, "org_ids": list(org_ids)},
        )
        return result.rowcount or 0


async def admin_transfer_ownership(
    *,
    org_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
    project_ids: List[uuid.UUID],
) -> List[uuid.UUID]:
    """The admin ownership transfer in one transaction, under the membership lock of
    each organization (the lock `MembershipsDAO` writers take).

    Under the locks it checks again that the source owns each organization and that
    the target has an organization row there; other organizations are left out.
    Then it moves the ownership, swaps the organization and project roles (projects
    of the transferred organizations only), and seeds the new owner into every
    project. Workspace rows are no longer written. Returns the transferred
    organization ids.
    """
    from oss.src.dbs.postgres.memberships.dao import (  # noqa: PLC0415
        ORGANIZATION_LOCK_SQL,
        PROMOTE_NEW_OWNER_SQL,
    )

    if not org_ids:
        return []

    async with _admin_session(None) as session:
        for org_id in sorted(org_ids, key=str):
            await session.execute(
                text(ORGANIZATION_LOCK_SQL), {"organization_id": str(org_id)}
            )

        owned = set(
            (
                await session.execute(
                    select(OrganizationDB.id).where(
                        OrganizationDB.id.in_(org_ids),
                        OrganizationDB.owner_id == source_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        members = set(
            (
                await session.execute(
                    select(OrganizationMemberDB.organization_id).where(
                        OrganizationMemberDB.user_id == target_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        eligible = [o for o in org_ids if o in owned and o in members]
        if not eligible:
            return []

        proj_scope = (
            (
                await session.execute(
                    select(ProjectDB.id).where(
                        ProjectDB.id.in_(project_ids),
                        ProjectDB.organization_id.in_(eligible),
                    )
                )
            )
            .scalars()
            .all()
            if project_ids
            else []
        )

        await admin_transfer_org_ownership_batch(eligible, target_id, session=session)
        # Both editions: OSS reads the organization role, so the source must not
        # keep `owner`.
        await admin_swap_org_memberships(
            eligible, source_id, target_id, session=session
        )
        if proj_scope:
            await admin_swap_project_memberships(
                list(proj_scope), source_id, target_id, session=session
            )
        # The resolver checks membership before the owner shortcut.
        await admin_seed_owner_project_rows(eligible, target_id, session=session)
        # As the app transfer: the new owner is `owner` on every row, whatever role
        # the swaps moved over.
        for org_id in eligible:
            for statement in PROMOTE_NEW_OWNER_SQL:
                await session.execute(
                    text(statement),
                    {"organization_id": org_id, "user_id": target_id},
                )

    return eligible


async def admin_delete_user_memberships(user_id: uuid.UUID) -> None:
    """Delete all organization and project memberships for a user."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(
            delete(OrganizationMemberDB).where(OrganizationMemberDB.user_id == user_id)
        )
        await session.execute(
            delete(ProjectMemberDB).where(ProjectMemberDB.user_id == user_id)
        )
        await session.commit()


async def user_exists(user_email: str) -> bool:
    """Check if a user exists in the database."""

    user = await get_user_with_email(email=user_email)
    return False if not user else True


def _role_slug(role: Any) -> str:
    """Normalize an enum or string role to its slug form."""
    return role.value if hasattr(role, "value") else str(role)


def _expand_permissions(slugs: List[str]) -> List[str]:
    """Expand the `"*"` wildcard to the full list of Permission enum values."""
    if "*" not in slugs:
        return slugs
    return [p.value for p in Permission]
