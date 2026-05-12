import os
import uuid
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.future import select
from sqlalchemy import delete, func, or_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from supertokens_python.types import AccountInfo
from sqlalchemy.orm import joinedload, load_only
from sqlalchemy.exc import NoResultFound, MultipleResultsFound
from supertokens_python.asyncio import list_users_by_account_info
from supertokens_python.asyncio import delete_user as delete_user_from_supertokens

from oss.src.utils.logging import get_module_logger
from oss.src.services import user_service, analytics_service
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.utils.helpers import get_slug_from_name_and_id

from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
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
    WorkspaceDB,
    ProjectDB,
)

from oss.src.models.db_models import (
    UserDB,
    APIKeyDB,
    InvitationDB,
    OrganizationDB,
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
    async with engine.core_session() as session:
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


async def fetch_projects_by_workspace(
    workspace_id: str,
) -> List[ProjectDB]:
    """
    Retrieve all projects that belong to a workspace ordered by creation date.
    Args:
        workspace_id (str): Workspace identifier.
    Returns:
        List[ProjectDB]: Projects scoped to the workspace.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(ProjectDB)
            .filter(ProjectDB.workspace_id == uuid.UUID(workspace_id))
            .order_by(ProjectDB.created_at.asc())
        )
        return result.scalars().all()


async def fetch_workspace_by_id(
    workspace_id: str,
) -> Optional[WorkspaceDB]:
    async with engine.core_session() as session:
        workspace = (
            (
                await session.execute(
                    select(WorkspaceDB).filter_by(
                        id=uuid.UUID(workspace_id),
                    )
                )
            )
            .scalars()
            .first()
        )

        return workspace


async def fetch_organization_by_id(
    organization_id: str,
) -> Optional[OrganizationDB]:
    async with engine.core_session() as session:
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

    workflows_dao = GitDAO(
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
            # Extract default settings for ground truth keys
            settings_values = {
                setting_name: setting.get("default")
                for setting_name, setting in evaluator.settings_template.items()
                if setting.get("ground_truth_key") is True
                and setting.get("default", "")
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

    async with engine.core_session() as session:
        # NOTE: Backward Compatibility
        # ---------------------------
        # Previously, the user_id field in the api_keys collection in MongoDB used the
        # session_id from SuperTokens in Cloud and  "0" as the uid in OSS.
        # During migration, we changed this to use the actual user ID. Therefore, we have two checks:
        # 1. Check if user_uid is found in the UserDB.uid column.
        # 2. If not found, check if user_uid is found in the UserDB.id column.
        conditions = [UserDB.uid == user_uid]
        if is_ee():
            conditions.append(UserDB.id == uuid.UUID(user_uid))

        result = await session.execute(select(UserDB).where(or_(*conditions)))
        user = result.scalars().first()

        return user


async def is_first_user_signup() -> bool:
    """Check if this is the first user signing up (no users exist yet)."""
    async with engine.core_session() as session:
        total_users = (
            await session.scalar(select(func.count()).select_from(UserDB)) or 0
        )
        return total_users == 0


async def get_oss_organization() -> Optional[OrganizationDB]:
    """Get the single OSS organization if it exists."""
    organizations_db = await get_organizations()
    if organizations_db:
        return organizations_db[0]
    return None


OSS_SINGLETON_ORG_SLUG = "oss-default"


async def get_or_bootstrap_oss_organization(
    *,
    user_id: uuid.UUID,
    user_email: str,
) -> OrganizationDB:
    """Get the OSS singleton organization, bootstrapping it if absent.

    The OSS singleton is identified by a deterministic
    ``slug`` (``OSS_SINGLETON_ORG_SLUG``) and the existing unique index on
    ``organizations.slug`` is the source of truth: at most one row with
    that slug can ever exist. Concurrent first-user callers race on
    ``INSERT ... ON CONFLICT (slug) DO NOTHING`` inside
    :func:`create_organization` and all read back the same winning row.

    No application-level lock is involved. The invariant is enforced by
    Postgres, which means it holds across any number of API replicas and
    through any connection pooler.
    """
    return await setup_oss_organization_for_first_user(
        user_id=user_id,
        user_email=user_email,
    )


async def setup_oss_organization_for_first_user(
    user_id: uuid.UUID,
    user_email: str,
) -> OrganizationDB:
    """
    Setup the OSS organization for the first user.

    This should only be called after the user has been created.

    Args:
        user_id: The UUID of the newly created user
        user_email: The email of the user (for analytics)

    Returns:
        OrganizationDB: The created organization
    """
    organization_db = await create_organization(
        name="Organization",
        owner_id=user_id,
        created_by_id=user_id,
    )

    # OSS is single-tenant: reuse the workspace already attached to the
    # singleton org if one exists, otherwise create it. Concurrent first-
    # user callers are serialized by taking a row lock on the singleton
    # org with SELECT ... FOR UPDATE inside a single transaction — the
    # second caller blocks until the first commits, then sees the
    # workspace and skips the insert. No schema change required.
    async with engine.core_session() as session:
        await session.execute(
            select(OrganizationDB.id).filter_by(id=organization_db.id).with_for_update()
        )

        existing_workspaces = await session.execute(
            select(WorkspaceDB).filter_by(organization_id=organization_db.id)
        )
        workspace_db = existing_workspaces.scalars().first()

        if workspace_db is None:
            workspace_db = WorkspaceDB(
                name="Default",
                organization_id=organization_db.id,
            )
            session.add(workspace_db)
            await session.commit()
            log.info(
                "[scopes] workspace created (oss singleton)",
                workspace_id=workspace_db.id,
            )
        else:
            # Releasing the lock by committing the empty transaction.
            await session.commit()

    # update default project with organization and workspace ids
    await create_or_update_default_project(
        values_to_update={
            "organization_id": organization_db.id,
            "workspace_id": workspace_db.id,
            "project_name": "Default",
        }
    )

    # Ensure project-scoped default environments exist for the default project.
    from oss.src.core.environments.defaults import create_default_environments
    from oss.src.core.evaluators.defaults import create_default_evaluators

    default_project_id = await get_default_project_id_from_workspace(
        str(workspace_db.id)
    )
    await create_default_environments(
        project_id=uuid.UUID(default_project_id),
        user_id=user_id,
    )
    await create_default_evaluators(
        project_id=uuid.UUID(default_project_id),
        user_id=user_id,
    )

    analytics_service.capture_oss_deployment_created(
        user_email=user_email,
        organization_id=str(organization_db.id),
    )

    return organization_db


async def check_if_user_invitation_exists(email: str, organization_id: str):
    """Check if a user invitation with the given email and organization_id exists."""

    project_db = await get_default_project_by_organization_id(
        organization_id=organization_id
    )
    if not project_db:
        raise NoResultFound(
            "Default project not found for user invitation in organization."
        )

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                email=email,
                project_id=project_db.id,
            )
        )
        user_invitation = result.scalars().first()

        total_users = (
            await session.scalar(select(func.count()).select_from(UserDB)) or 0
        )

        if not user_invitation and (total_users == 0):
            return True

        if not user_invitation:
            return False

        return True


async def create_accounts(payload: dict) -> UserDB:
    """Create a new account in the database.

    This unified function handles user creation and delegates organization/workspace
    assignment to implementation-specific logic (OSS vs EE).

    Args:
        payload (dict): The payload containing 'uid' and 'email' for user creation.
                       In OSS, payload may contain 'organization_id' (pre-computed).
                       In EE, 'organization_id' is not expected.

    Returns:
        UserDB: instance of user
    """

    # Create user
    user_info = {**payload, "username": payload["email"].split("@")[0]}
    # Remove OSS-specific fields that shouldn't go to UserDB
    user_info.pop("organization_id", None)

    user_db = await user_service.create_new_user(payload=user_info)

    # Delegate organization/workspace assignment to implementation-specific function
    if is_ee():
        # EE implementation: handled by ee.src.services.commoners.create_accounts
        # This function should NOT be called for EE - see __init__.py imports
        pass
    else:
        # OSS implementation: assign user to pre-created single organization
        organization_id = payload.get("organization_id")
        if organization_id:
            await _assign_user_to_organization_oss(
                user_db=user_db,
                organization_id=organization_id,
                email=payload["email"],
            )

    return user_db


async def _assign_user_to_organization_oss(
    user_db: UserDB,
    organization_id: str,
    email: str,
) -> None:
    """
    OSS-specific logic to assign a user to the single organization.

    In OSS, all users are assigned to the same organization created at first sign-up.

    Args:
        user_db: The created user
        organization_id: The single organization ID (pre-created)
        email: User's email
    """
    # Only update organization to have user_db as its "owner" if it does not yet have one
    # This only happens in the first-user scenario
    try:
        await get_organization_owner(organization_id=organization_id)
    except (NoResultFound, ValueError):
        await update_organization(
            organization_id=organization_id, values_to_update={"owner_id": user_db.id}
        )

    # Get the singleton default project belonging to organization. We must
    # filter by is_default=True because OSS now mints per-account ephemeral
    # projects under the same singleton workspace; the unfiltered lookup
    # would non-deterministically attach invitations to the wrong project.
    project_db = await get_default_project_by_organization_id(
        organization_id=organization_id
    )
    if project_db is None:
        raise NoResultFound(
            f"No default project found for organization_id {organization_id} "
            "while assigning user; OSS singleton is in an inconsistent state."
        )

    # Update user invitation if the user was invited
    invitation = await get_project_invitation_by_email(
        project_id=str(project_db.id), email=email
    )
    if invitation is not None:
        await update_invitation(
            invitation_id=str(invitation.id),
            values_to_update={"user_id": str(user_db.id), "used": True},
        )


async def get_default_workspace_id_oss() -> str:
    """
    Get the default workspace ID in OSS.

    New OSS bootstraps create exactly one workspace per singleton org —
    the FOR UPDATE lock in setup_oss_organization_for_first_user makes
    that race-free. Pre-fix deployments may have leftover duplicate
    workspaces; rather than crashing the auth path with an AssertionError
    (which then gets cached as a deny and locks every user out for the
    full TTL), we deterministically pick the oldest row attached to the
    OSS singleton organization and log a warning so the leftover can be
    cleaned up. We filter by the singleton org explicitly so that
    leftover workspaces from non-singleton orgs (possible on pre-fix
    deployments where ``admin_create_organization`` minted multiple
    orgs) cannot shadow the real singleton workspace and steer auth
    scope resolution to the wrong tenant.
    """
    async with engine.core_session() as session:
        result = await session.execute(
            select(WorkspaceDB)
            .join(OrganizationDB, WorkspaceDB.organization_id == OrganizationDB.id)
            .where(OrganizationDB.slug == OSS_SINGLETON_ORG_SLUG)
            .order_by(WorkspaceDB.created_at.asc())
        )
        workspaces = result.scalars().all()

    if not workspaces:
        raise NoResultFound(
            "OSS singleton is in an inconsistent state: no workspace exists."
        )

    if len(workspaces) > 1:
        log.warning(
            "[scopes] multiple OSS workspaces found, using the oldest. "
            "This indicates leftover duplicates from a pre-singleton-fix "
            "deployment; manual cleanup recommended.",
            workspace_count=len(workspaces),
            chosen_workspace_id=str(workspaces[0].id),
        )

    return str(workspaces[0].id)


async def create_organization(
    name: str,
    owner_id: Optional[uuid.UUID] = None,
    created_by_id: Optional[uuid.UUID] = None,
):
    """Create a new organization in the database.

    In OSS the org is a singleton, so we attach a deterministic slug
    (``OSS_SINGLETON_ORG_SLUG``) and use ``INSERT ... ON CONFLICT (slug)
    DO NOTHING`` so concurrent first-user signups collapse to the same row
    instead of producing duplicates. The unique index on
    ``organizations.slug`` is the source of truth.

    EE keeps the previous behavior (one org per signup, slug left NULL).
    """

    async with engine.core_session() as session:
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

        if not is_ee():
            stmt = (
                pg_insert(OrganizationDB)
                .values(
                    slug=OSS_SINGLETON_ORG_SLUG,
                    name=name,
                    flags=flags,
                    owner_id=_owner_id,
                    created_by_id=_created_by_id,
                )
                .on_conflict_do_nothing(index_elements=["slug"])
            )
            await session.execute(stmt)
            await session.commit()

            result = await session.execute(
                select(OrganizationDB).filter_by(slug=OSS_SINGLETON_ORG_SLUG)
            )
            organization_db = result.scalars().one()

            log.info(
                "[scopes] organization ensured (oss singleton)",
                organization_id=organization_db.id,
            )
            return organization_db

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


async def create_workspace(name: str, organization_id: str):
    """Create a new workspace in the database.

    Args:
        name (str): The name of the workspace
        organization_id (str): The ID of the organization

    Returns:
        WorkspaceDB: instance of workspace
    """

    async with engine.core_session() as session:
        workspace_db = WorkspaceDB(
            name=name,
            organization_id=uuid.UUID(organization_id),
            description="Default Workspace",
            type="default",
        )

        session.add(workspace_db)

        await session.commit()

        log.info(
            "[scopes] workspace created",
            organization_id=organization_id,
            workspace_id=workspace_db.id,
        )

        return workspace_db


async def update_organization(organization_id: str, values_to_update: Dict[str, Any]):
    """
    Update the specified organization in the database.

    Args:
        organization_id (str): The ID of the organization
        values_to_update (Dict[str, Any]): The values to update in the organization
    """

    async with engine.core_session() as session:
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


async def create_or_update_default_project(values_to_update: Dict[str, Any]):
    """Update the specified project in the database.

    Args:
        values_to_update (Dict[str, Any]): The values to update in the project
    """

    organization_id = values_to_update.get("organization_id")
    if organization_id is None:
        raise ValueError(
            "create_or_update_default_project requires 'organization_id' in values_to_update"
        )

    async with engine.core_session() as session:
        result = await session.execute(
            select(ProjectDB).filter_by(
                organization_id=organization_id,
                is_default=True,
            )
        )
        project = result.scalars().first()

        if project is None:
            project = ProjectDB(project_name="Default", is_default=True)

            session.add(project)

        for key, value in values_to_update.items():
            if hasattr(project, key):
                setattr(project, key, value)

        await session.commit()
        await session.refresh(project)


async def get_organizations() -> List[OrganizationDB]:
    """
    Retrieve organizations from the database by their IDs.

    Returns:
        List: A list of organizations.
    """

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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
    # Import OrganizationMemberDB conditionally (EE only)
    if is_ee():
        from ee.src.models.db_models import OrganizationMemberDB

        async with engine.core_session() as session:
            # Query organizations through organization_members table
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
    else:
        # OSS mode: return empty list or implement simplified logic
        # In OSS, users might only have one default organization
        return []


async def get_workspace(workspace_id: str) -> WorkspaceDB:
    """
    Retrieve a workspace.

    Args:
        workspace_id (str): The workspace id.

    Returns:
        Workspace: The retrieved workspace.
    """

    async with engine.core_session() as session:
        query = select(WorkspaceDB).filter_by(id=uuid.UUID(workspace_id))

        result = await session.execute(query)
        workspace = result.scalars().first()
        return workspace


async def get_workspaces() -> List[WorkspaceDB]:
    """
    Retrieve workspaces from the database by their IDs.

    Returns:
        List: A list of workspaces.
    """

    async with engine.core_session() as session:
        result = await session.execute(select(WorkspaceDB))
        workspaces = result.scalars().all()
        return workspaces


async def remove_user_from_workspace(project_id: str, email: str):
    """Remove a user from a workspace.

    Args:
        project_id (str): The ID of the project
        email (str): The email of the user to remove
    """

    user = await get_user_with_email(email=email)
    user_invitation = await get_project_invitation_by_email(
        project_id=project_id, email=email
    )

    user_id = user.id if user else None

    project = await fetch_project_by_id(project_id=project_id)

    if not project:
        raise NoResultFound(f"Project with ID {project_id} not found")

    async with engine.core_session() as session:
        if user:
            await session.delete(user)

            log.info(
                "[scopes] user deleted",
                user_id=user_id,
            )

        if user_invitation:
            user_info_from_supertokens = await list_users_by_account_info(
                tenant_id="public", account_info=AccountInfo(email=email)
            )
            if len(user_info_from_supertokens) >= 1:
                await delete_user_from_supertokens(
                    user_id=user_info_from_supertokens[0].id
                )

            await session.delete(user_invitation)

            log.info(
                "[scopes] invitation deleted",
                organization_id=project.organization_id,
                workspace_id=project.workspace_id,
                project_id=project_id,
                user_id=user_id,
                invitation_id=user_invitation.id,
            )

        await session.commit()


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

    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(id=uuid.UUID(user_id)))
        user = result.scalars().first()
        if user is None:
            log.error("Failed to get user with id")
            raise NoResultFound(f"User with id {user_id} not found")
        return user


async def update_user_username(user_id: str, username: str) -> UserDB:
    """Update a user's username."""

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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
            workspace_id=project.workspace_id,
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

    async with engine.core_session() as session:
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
    """
    Get the default project ID belonging to a user from a workspace.

    Args:
        workspace_id (str): The ID of the workspace.

    Returns:
        Union[str, Exception]: The default project ID or an exception error message.
    """

    async with engine.core_session() as session:
        project_query = await session.execute(
            select(ProjectDB)
            .where(
                ProjectDB.workspace_id == uuid.UUID(workspace_id),
                ProjectDB.is_default == True,  # noqa: E712
            )
            .options(load_only(ProjectDB.id))
        )
        project = project_query.scalars().first()
        if project is None:
            raise NoResultFound(
                f"No default project for the provided workspace_id {workspace_id} found"
            )
        return str(project.id)


async def create_workspace_project(
    project_name: str,
    workspace_id: str,
    organization_id: Optional[str] = None,
    *,
    set_default: bool = False,
    session: Optional[AsyncSession] = None,
) -> ProjectDB:
    """
    Create a project scoped to the provided workspace.

    Args:
        project_name (str): Display name for the project.
        workspace_id (str): Workspace identifier.
        organization_id (Optional[str]): Explicit organization id. If omitted it will be
            inferred from the workspace.
        set_default (bool): Whether the project should become the workspace default.
        session (Optional[AsyncSession]): Existing db session reuse.

    Returns:
        ProjectDB: Newly created project.
    """

    workspace_uuid = uuid.UUID(workspace_id)

    async def _create(
        db_session: AsyncSession,
    ) -> ProjectDB:
        workspace = await db_session.get(WorkspaceDB, workspace_uuid)
        if workspace is None:
            raise NoResultFound(f"Workspace with ID {workspace_id} not found")

        org_uuid = (
            uuid.UUID(organization_id) if organization_id else workspace.organization_id
        )

        should_be_default = set_default
        if not should_be_default:
            result = await db_session.execute(
                select(ProjectDB.id).filter(
                    ProjectDB.workspace_id == workspace_uuid,
                    ProjectDB.is_default == True,  # noqa: E712
                )
            )
            has_default = result.scalars().first() is not None
            should_be_default = not has_default

        if should_be_default:
            await db_session.execute(
                update(ProjectDB)
                .where(
                    ProjectDB.workspace_id == workspace_uuid,
                    ProjectDB.is_default == True,  # noqa: E712
                )
                .values(is_default=False)
            )

        project_db = ProjectDB(
            project_name=project_name,
            is_default=should_be_default,
            organization_id=org_uuid,
            workspace_id=workspace_uuid,
        )

        db_session.add(project_db)
        await db_session.commit()
        await db_session.refresh(project_db)

        log.info(
            "[scopes] project created",
            organization_id=str(org_uuid),
            workspace_id=str(workspace_uuid),
            project_id=str(project_db.id),
            is_default=project_db.is_default,
        )

        return project_db

    if session is not None:
        return await _create(session)

    async with engine.core_session() as new_session:
        return await _create(new_session)


async def delete_project(project_id: str) -> None:
    """
    Delete a project if it is not the default one.

    Args:
        project_id (str): Identifier of project to delete.
    """

    async with engine.core_session() as session:
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
            workspace_id=str(project.workspace_id),
            project_id=project_id,
        )


async def set_default_project(project_id: str) -> ProjectDB:
    """
    Mark the provided project as the default for its workspace.

    Args:
        project_id (str): Identifier of project to promote.

    Returns:
        ProjectDB: Updated project.
    """

    async with engine.core_session() as session:
        project = await session.get(ProjectDB, uuid.UUID(project_id))
        if project is None:
            raise NoResultFound(f"Project with ID {project_id} not found")

        if project.is_default:
            return project

        await session.execute(
            update(ProjectDB)
            .where(
                ProjectDB.workspace_id == project.workspace_id,
                ProjectDB.is_default == True,  # noqa: E712
            )
            .values(is_default=False)
        )

        project.is_default = True
        await session.commit()
        await session.refresh(project)

        log.info(
            "[scopes] project set as default",
            organization_id=str(project.organization_id),
            workspace_id=str(project.workspace_id),
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

    async with engine.core_session() as session:
        project = await session.get(ProjectDB, uuid.UUID(project_id))
        if project is None:
            raise NoResultFound(f"Project with ID {project_id} not found")

        project.project_name = project_name.strip()
        await session.commit()
        await session.refresh(project)

        log.info(
            "[scopes] project renamed",
            organization_id=str(project.organization_id),
            workspace_id=str(project.workspace_id),
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

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), email=email
            )
        )
        invitation = result.scalars().first()
        return invitation


async def get_project_invitations(project_id: str) -> InvitationDB:
    """Get project invitations.

    Args:
        project_id (str): The ID of the project.

    Returns:
        List[InvitationDB]: invitation objects
    """

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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
            workspace_id=project.workspace_id,
            project_id=invitation.project_id,
            user_id=invitation.user_id,
            invitation_id=invitation.id,
        )

        await session.commit()

        return True


async def get_project_by_organization_id(organization_id: str):
    """Get project by organization ID.

    Args:
        organization_id (str): The ID of the organization.

    Returns:
        ProjectDB: project object
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(ProjectDB).filter_by(organization_id=uuid.UUID(organization_id))
        )
        project = result.scalars().first()
        return project


async def get_default_project_by_organization_id(organization_id: str):
    """Get the default project for an organization.

    Unlike `get_project_by_organization_id`, this filters to `is_default=True`
    so callers that depend on the OSS singleton invariant don't accidentally
    pick up an ephemeral per-account project.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(ProjectDB).filter_by(
                organization_id=uuid.UUID(organization_id),
                is_default=True,
            )
        )
        return result.scalars().first()


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

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), token=token, email=email
            )
        )
        invitation = result.scalars().first()
        return invitation


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

    async with engine.core_session() as session:
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
    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(id=user_id))
        return result.scalars().first()


async def admin_get_user_by_email(email: str) -> Optional[UserDB]:
    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(email=email))
        return result.scalars().first()


async def admin_get_org_by_id(org_id: uuid.UUID) -> Optional[OrganizationDB]:
    async with engine.core_session() as session:
        result = await session.execute(select(OrganizationDB).filter_by(id=org_id))
        return result.scalars().first()


async def admin_get_org_by_slug(slug: str) -> Optional[OrganizationDB]:
    async with engine.core_session() as session:
        result = await session.execute(select(OrganizationDB).filter_by(slug=slug))
        return result.scalars().first()


async def admin_get_workspace_by_id(ws_id: uuid.UUID) -> Optional[WorkspaceDB]:
    async with engine.core_session() as session:
        result = await session.execute(select(WorkspaceDB).filter_by(id=ws_id))
        return result.scalars().first()


async def admin_get_project_by_id(proj_id: uuid.UUID) -> Optional[ProjectDB]:
    async with engine.core_session() as session:
        result = await session.execute(select(ProjectDB).filter_by(id=proj_id))
        return result.scalars().first()


async def admin_get_api_key_by_id(key_id: uuid.UUID) -> Optional[APIKeyDB]:
    async with engine.core_session() as session:
        result = await session.execute(select(APIKeyDB).filter_by(id=key_id))
        return result.scalars().first()


async def admin_get_api_key_by_prefix(prefix: str) -> Optional[APIKeyDB]:
    async with engine.core_session() as session:
        result = await session.execute(select(APIKeyDB).filter_by(prefix=prefix))
        return result.scalars().first()


async def admin_get_orgs_owned_by_user(user_id: uuid.UUID) -> List[OrganizationDB]:
    """Return orgs where user is owner OR creator (both carry RESTRICT FK)."""
    async with engine.core_session() as session:
        result = await session.execute(
            select(OrganizationDB).where(
                or_(
                    OrganizationDB.owner_id == user_id,
                    OrganizationDB.created_by_id == user_id,
                )
            )
        )
        return list(result.scalars().all())


async def admin_get_workspace_ids_for_orgs(
    org_ids: List[uuid.UUID],
) -> List[uuid.UUID]:
    async with engine.core_session() as session:
        result = await session.execute(
            select(WorkspaceDB.id).where(WorkspaceDB.organization_id.in_(org_ids))
        )
        return [row[0] for row in result]


async def admin_get_project_ids_for_orgs(
    org_ids: List[uuid.UUID],
) -> List[uuid.UUID]:
    async with engine.core_session() as session:
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
    async with engine.core_session() as session:
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
    """Create or reuse an organization (admin path).

    On OSS every org collapses onto the deterministic singleton slug —
    the caller's requested ``name``/``slug`` are ignored and the existing
    singleton row is returned (creating it on first call). The unique
    index on ``organizations.slug`` is the source of truth, so concurrent
    callers are safe and no application lock is needed. Combined with the
    delete guard in the accounts service, this makes the OSS singleton
    invariant absolute: exactly one organization exists, and it cannot be
    duplicated or removed.

    On EE behavior is unchanged: a new row is inserted with the supplied
    ``name``/``slug``.
    """
    async with engine.core_session() as session:
        if not is_ee():
            stmt = (
                pg_insert(OrganizationDB)
                .values(
                    slug=OSS_SINGLETON_ORG_SLUG,
                    name=name,
                    flags={"is_demo": False},
                    owner_id=owner_id,
                    created_by_id=owner_id,
                )
                .on_conflict_do_nothing(index_elements=["slug"])
            )
            await session.execute(stmt)
            await session.commit()

            result = await session.execute(
                select(OrganizationDB).filter_by(slug=OSS_SINGLETON_ORG_SLUG)
            )
            org_db = result.scalars().one()
            log.info(
                "[admin] organization ensured (oss singleton)",
                organization_id=str(org_db.id),
            )
            return org_db

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


async def admin_create_workspace(
    name: str,
    org_id: uuid.UUID,
    *,
    is_default: bool = False,
) -> WorkspaceDB:
    """Create or reuse a workspace (admin path).

    On OSS the workspace under the singleton org is itself a singleton —
    if one already exists it is returned; otherwise a single new
    workspace is created under a row lock on the org so concurrent
    callers converge on the same row. Combined with admin_create_organization
    and the delete guards, OSS exposes exactly one org and one workspace.

    On EE behavior is unchanged: a fresh workspace row is always inserted.
    """
    async with engine.core_session() as session:
        if not is_ee():
            await session.execute(
                select(OrganizationDB.id).filter_by(id=org_id).with_for_update()
            )
            existing = await session.execute(
                select(WorkspaceDB).filter_by(organization_id=org_id)
            )
            ws_db = existing.scalars().first()
            if ws_db is not None:
                await session.commit()
                return ws_db

            ws_db = WorkspaceDB(
                name=name,
                type="default" if is_default else None,
                organization_id=org_id,
            )
            session.add(ws_db)
            await session.commit()
            await session.refresh(ws_db)
            log.info(
                "[admin] workspace ensured (oss singleton)",
                workspace_id=str(ws_db.id),
            )
            return ws_db

        ws_db = WorkspaceDB(
            name=name,
            type="default" if is_default else None,
            organization_id=org_id,
        )
        session.add(ws_db)
        await session.commit()
        await session.refresh(ws_db)
        log.info("[admin] workspace created", workspace_id=str(ws_db.id))
        return ws_db


async def admin_create_project(
    name: str,
    org_id: uuid.UUID,
    ws_id: uuid.UUID,
    *,
    is_default: bool = False,
) -> ProjectDB:
    async with engine.core_session() as session:
        proj_db = ProjectDB(
            project_name=name,
            is_default=is_default,
            organization_id=org_id,
            workspace_id=ws_id,
        )
        session.add(proj_db)
        await session.commit()
        await session.refresh(proj_db)
        log.info("[admin] project created", project_id=str(proj_db.id))
        return proj_db


async def admin_delete_user(user_id: uuid.UUID) -> None:
    async with engine.core_session() as session:
        await session.execute(delete(UserDB).where(UserDB.id == user_id))
        await session.commit()


async def admin_delete_organization(org_id: uuid.UUID) -> None:
    async with engine.core_session() as session:
        await session.execute(delete(OrganizationDB).where(OrganizationDB.id == org_id))
        await session.commit()


async def admin_delete_workspace(ws_id: uuid.UUID) -> None:
    async with engine.core_session() as session:
        await session.execute(delete(WorkspaceDB).where(WorkspaceDB.id == ws_id))
        await session.commit()


async def admin_delete_project(proj_id: uuid.UUID) -> None:
    async with engine.core_session() as session:
        await session.execute(delete(ProjectDB).where(ProjectDB.id == proj_id))
        await session.commit()


async def admin_delete_api_key(key_id: uuid.UUID) -> None:
    async with engine.core_session() as session:
        await session.execute(delete(APIKeyDB).where(APIKeyDB.id == key_id))
        await session.commit()


async def admin_delete_accounts_batch(
    *,
    org_ids: List[uuid.UUID],
    workspace_ids: List[uuid.UUID],
    project_ids: List[uuid.UUID],
    user_ids: List[uuid.UUID],
) -> None:
    """Delete a batch of entities atomically, in dependency order."""
    async with engine.core_session() as session:
        for proj_id in project_ids:
            await session.execute(delete(ProjectDB).where(ProjectDB.id == proj_id))
        for ws_id in workspace_ids:
            await session.execute(delete(WorkspaceDB).where(WorkspaceDB.id == ws_id))
        for org_id in org_ids:
            await session.execute(
                delete(OrganizationDB).where(OrganizationDB.id == org_id)
            )
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
        workspace_ids=[],
        project_ids=[],
        user_ids=[user_id],
    )
    return org_ids


async def admin_transfer_org_ownership_batch(
    org_ids: List[uuid.UUID],
    target_id: uuid.UUID,
) -> None:
    """Update owner_id and created_by_id on multiple orgs.

    Both columns carry a RESTRICT FK to users.id at the DB level.
    Transferring created_by_id alongside owner_id ensures the source
    user has no remaining FK references, so a subsequent cascade delete
    of that user does not destroy orgs now owned by the target.
    """
    now = datetime.now(timezone.utc)
    async with engine.core_session() as session:
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
        await session.commit()
