import os
import uuid
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.future import select
from sqlalchemy import delete, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from supertokens_python.types import AccountInfo
from sqlalchemy.orm import joinedload, load_only
from sqlalchemy.exc import NoResultFound, MultipleResultsFound
from supertokens_python.asyncio import list_users_by_account_info
from supertokens_python.asyncio import delete_user as delete_user_from_supertokens

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.dbs.postgres.shared.engine import (
    get_transactions_engine,
)
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
    OrganizationMemberDB,
    WorkspaceMemberDB,
    ProjectMemberDB,
)
from oss.src.dbs.postgres.webhooks.dbes import WebhookSubscriptionDBE
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

    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            select(ProjectDB)
            .filter(ProjectDB.workspace_id == uuid.UUID(workspace_id))
            .order_by(ProjectDB.created_at.asc())
        )
        return result.scalars().all()


async def fetch_project_memberships_by_user_id(
    user_id: str,
) -> List[ProjectMemberDB]:
    """Retrieve every project membership for a user across all organizations."""

    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            select(ProjectMemberDB)
            .filter_by(user_id=uuid.UUID(user_id))
            .options(
                joinedload(ProjectMemberDB.project).joinedload(ProjectDB.workspace),
                joinedload(ProjectMemberDB.project).joinedload(ProjectDB.organization),
            )
        )
        return result.scalars().all()


async def fetch_workspace_by_id(
    workspace_id: str,
) -> Optional[WorkspaceDB]:
    engine = get_transactions_engine()
    async with engine.session() as session:
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


async def get_default_workspace_id(user_id: str) -> str:
    """
    Retrieve the default workspace ID for a user: the workspace they own,
    falling back to their oldest membership.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB)
            .filter_by(user_id=uuid.UUID(user_id))
            .options(  # type: ignore
                load_only(
                    WorkspaceMemberDB.workspace_id,
                    WorkspaceMemberDB.role,
                    WorkspaceMemberDB.created_at,
                )
            )
        )
        memberships = list(result.scalars().all())

        if not memberships:
            raise NoResultFound(f"No workspace membership found for user {user_id}")

        memberships.sort(
            key=lambda membership: (
                membership.created_at or datetime.min.replace(tzinfo=timezone.utc),
                str(membership.workspace_id),
            )
        )

        owner_membership = next(
            (membership for membership in memberships if membership.role == "owner"),
            None,
        )
        if owner_membership is not None:
            return str(owner_membership.workspace_id)

        return str(memberships[0].workspace_id)


async def get_user_workspaces(user_id: str) -> List[WorkspaceDB]:
    """Retrieve all workspaces the user is a member of."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceDB)
            .join(
                WorkspaceMemberDB,
                WorkspaceDB.id == WorkspaceMemberDB.workspace_id,
            )
            .filter(WorkspaceMemberDB.user_id == uuid.UUID(user_id))
            .order_by(WorkspaceDB.created_at.asc())
        )
        return list(result.scalars().all())


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


async def create_workspace(name: str, organization_id: str):
    """Create a new workspace in the database.

    Args:
        name (str): The name of the workspace
        organization_id (str): The ID of the organization

    Returns:
        WorkspaceDB: instance of workspace
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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


async def add_user_to_organization(
    organization_id: str,
    user_id: str,
    role: str = "viewer",
) -> None:
    engine = get_transactions_engine()

    async with engine.session() as session:
        organization_member = OrganizationMemberDB(
            user_id=user_id,
            organization_id=organization_id,
            role=role,
        )

        session.add(organization_member)

        await session.commit()

        log.info(
            "[scopes] organization membership created",
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            membership_id=organization_member.id,
        )


async def add_user_to_workspace(
    workspace_id: str,
    user_id: str,
    role: str,
) -> None:
    engine = get_transactions_engine()

    async with engine.session() as session:
        stmt = select(WorkspaceDB).filter_by(id=workspace_id)
        workspace = await session.execute(stmt)
        workspace = workspace.scalars().first()

        if not workspace:
            raise Exception(f"No workspace found with ID {workspace_id}")

        workspace_member = WorkspaceMemberDB(
            user_id=user_id,
            workspace_id=workspace_id,
            role=role,
        )

        session.add(workspace_member)

        await session.commit()

        log.info(
            "[scopes] workspace membership created",
            organization_id=workspace.organization_id,
            workspace_id=workspace_id,
            user_id=user_id,
            membership_id=workspace_member.id,
        )


async def add_user_to_project(
    project_id: str,
    user_id: str,
    role: str,
    is_demo: bool = False,
) -> None:
    project = await fetch_project_by_id(
        project_id=project_id,
    )

    if not project:
        raise Exception(f"No project found with ID {project_id}")

    engine = get_transactions_engine()

    async with engine.session() as session:
        project_member = ProjectMemberDB(
            user_id=user_id,
            project_id=project_id,
            role=role,
            is_demo=is_demo,
        )

        session.add(project_member)

        await session.commit()

        log.info(
            "[scopes] project membership created",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=project_id,
            user_id=user_id,
            membership_id=project_member.id,
        )


async def add_user_to_workspace_and_org(
    organization: OrganizationDB,
    workspace: WorkspaceDB,
    user: UserDB,
    project_id: str,
    role: str,
) -> bool:
    project = await get_project_by_id(project_id=project_id)
    if project and str(project.workspace_id) != str(workspace.id):
        raise ValueError("Project does not belong to the provided workspace")

    engine = get_transactions_engine()

    async with engine.session() as session:
        user_organization = OrganizationMemberDB(
            user_id=user.id, organization_id=organization.id
        )

        session.add(user_organization)

        await session.commit()

        log.info(
            "[scopes] organization membership created",
            organization_id=organization.id,
            user_id=user.id,
            membership_id=user_organization.id,
        )

        workspace_member = WorkspaceMemberDB(
            user_id=user.id,
            workspace_id=workspace.id,
            role=role,
        )

        session.add(workspace_member)

        await session.commit()

        log.info(
            "[scopes] workspace membership created",
            organization_id=organization.id,
            workspace_id=workspace.id,
            user_id=user.id,
            membership_id=workspace_member.id,
        )

        projects = await fetch_projects_by_workspace(str(workspace.id))
        if not projects:
            raise NoResultFound(
                f"No projects found for workspace_id {str(workspace.id)}"
            )

        existing_members_result = await session.execute(
            select(ProjectMemberDB).filter(
                ProjectMemberDB.project_id.in_([project.id for project in projects]),
                ProjectMemberDB.user_id == user.id,
            )
        )
        existing_members = {
            member.project_id: member
            for member in existing_members_result.scalars().all()
        }

        for project in projects:
            if project.id in existing_members:
                continue

            project_member = ProjectMemberDB(
                user_id=user.id,
                project_id=project.id,
                role=role,
            )

            session.add(project_member)

            await session.commit()

            log.info(
                "[scopes] project membership created",
                organization_id=str(project.organization_id),
                workspace_id=str(project.workspace_id),
                project_id=str(project.id),
                user_id=str(user.id),
                membership_id=project_member.id,
            )

        return True


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

        await session.delete(organization)
        await session.commit()
        return True


async def transfer_organization_ownership(
    organization_id: str,
    new_owner_id: str,
    current_user_id: str,
) -> OrganizationDB:
    """Transfer organization ownership to another member, swapping the two
    users' org and workspace roles.

    Raises:
        ValueError: If new owner is not a member of the organization
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        org_result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = org_result.scalars().first()
        if not organization:
            raise ValueError(f"Organization {organization_id} not found")

        member_result = await session.execute(
            select(OrganizationMemberDB).filter_by(
                user_id=uuid.UUID(new_owner_id),
                organization_id=uuid.UUID(organization_id),
            )
        )
        member = member_result.scalars().first()
        if not member:
            raise ValueError("The new owner must be a member of the organization")

        current_owner_org_member_result = await session.execute(
            select(OrganizationMemberDB).filter_by(
                user_id=uuid.UUID(current_user_id),
                organization_id=uuid.UUID(organization_id),
            )
        )
        current_owner_org_member = current_owner_org_member_result.scalars().first()

        if current_owner_org_member:
            current_owner_org_old_role = current_owner_org_member.role
            new_owner_org_old_role = member.role

            current_owner_org_member.role = new_owner_org_old_role
            member.role = current_owner_org_old_role

            log.info(
                "[organization] roles swapped",
                organization_id=organization_id,
                current_owner_id=current_user_id,
                new_owner_id=new_owner_id,
            )

        workspaces_result = await session.execute(
            select(WorkspaceDB).filter_by(organization_id=uuid.UUID(organization_id))
        )
        workspaces = workspaces_result.scalars().all()

        for workspace in workspaces:
            current_owner_member_result = await session.execute(
                select(WorkspaceMemberDB).filter_by(
                    user_id=uuid.UUID(current_user_id),
                    workspace_id=workspace.id,
                )
            )
            current_owner_member = current_owner_member_result.scalars().first()

            new_owner_member_result = await session.execute(
                select(WorkspaceMemberDB).filter_by(
                    user_id=uuid.UUID(new_owner_id),
                    workspace_id=workspace.id,
                )
            )
            new_owner_member = new_owner_member_result.scalars().first()

            if current_owner_member and new_owner_member:
                current_owner_old_role = current_owner_member.role
                new_owner_old_role = new_owner_member.role

                current_owner_member.role = new_owner_old_role
                new_owner_member.role = current_owner_old_role

                log.info(
                    "[workspace] roles swapped",
                    workspace_id=str(workspace.id),
                    current_owner_id=current_user_id,
                    new_owner_id=new_owner_id,
                )
            elif current_owner_member:
                log.info(
                    "[workspace] new owner not a member",
                    workspace_id=str(workspace.id),
                    user_id=new_owner_id,
                )
            elif new_owner_member:
                log.info(
                    "[workspace] current owner not a member",
                    workspace_id=str(workspace.id),
                    user_id=current_user_id,
                )

        organization.owner_id = uuid.UUID(new_owner_id)
        organization.updated_at = datetime.now(timezone.utc)
        organization.updated_by_id = uuid.UUID(current_user_id)

        await session.commit()
        await session.refresh(organization)

        log.info(
            "[organization] ownership transferred",
            organization_id=organization_id,
            old_owner_id=current_user_id,
            new_owner_id=new_owner_id,
        )

        return organization


async def get_workspace(workspace_id: str) -> WorkspaceDB:
    """
    Retrieve a workspace.

    Args:
        workspace_id (str): The workspace id.

    Returns:
        Workspace: The retrieved workspace.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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
    """
    Get the default project ID belonging to a user from a workspace.

    Args:
        workspace_id (str): The ID of the workspace.

    Returns:
        Union[str, Exception]: The default project ID or an exception error message.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
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
        project_db = await _create(session)
        await sync_workspace_members_to_project(str(project_db.id), session=session)
        return project_db

    engine = get_transactions_engine()
    async with engine.session() as new_session:
        project_db = await _create(new_session)
        await sync_workspace_members_to_project(str(project_db.id), session=new_session)
        return project_db


async def sync_workspace_members_to_project(
    project_id: str,
    session: Optional[AsyncSession] = None,
) -> None:
    """Ensure all workspace members are mirrored as project members."""

    async def _sync(db_session: AsyncSession) -> None:
        project = await db_session.get(ProjectDB, uuid.UUID(project_id))
        if project is None:
            raise NoResultFound(f"Project with ID {project_id} not found")

        workspace_members_result = await db_session.execute(
            select(WorkspaceMemberDB).filter_by(workspace_id=project.workspace_id)
        )
        workspace_members = workspace_members_result.scalars().all()
        if not workspace_members:
            return

        user_ids = [member.user_id for member in workspace_members]
        existing_members_result = await db_session.execute(
            select(ProjectMemberDB).filter(
                ProjectMemberDB.project_id == project.id,
                ProjectMemberDB.user_id.in_(user_ids),
            )
        )
        existing_members = {
            member.user_id: member for member in existing_members_result.scalars().all()
        }

        for member in workspace_members:
            project_member = existing_members.get(member.user_id)
            if project_member:
                if project_member.role != member.role:
                    project_member.role = member.role
                continue

            db_session.add(
                ProjectMemberDB(
                    user_id=member.user_id,
                    project_id=project.id,
                    role=member.role,
                )
            )

        await db_session.commit()

    if session is not None:
        await _sync(session)
        return

    engine = get_transactions_engine()
    async with engine.session() as new_session:
        await _sync(new_session)


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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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
    engine = get_transactions_engine()

    async with engine.session() as session:
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


async def admin_get_workspace_by_id(ws_id: uuid.UUID) -> Optional[WorkspaceDB]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(WorkspaceDB).filter_by(id=ws_id))
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


async def admin_get_workspace_ids_for_orgs(
    org_ids: List[uuid.UUID],
) -> List[uuid.UUID]:
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceDB.id).where(WorkspaceDB.organization_id.in_(org_ids))
        )
        return [row[0] for row in result]


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
    engine = get_transactions_engine()

    async with engine.session() as session:
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
    engine = get_transactions_engine()

    async with engine.session() as session:
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
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(delete(UserDB).where(UserDB.id == user_id))
        await session.commit()


async def admin_delete_organization(org_id: uuid.UUID) -> None:
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(delete(OrganizationDB).where(OrganizationDB.id == org_id))
        await session.commit()


async def admin_delete_workspace(ws_id: uuid.UUID) -> None:
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(delete(WorkspaceDB).where(WorkspaceDB.id == ws_id))
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
    workspace_ids: List[uuid.UUID],
    project_ids: List[uuid.UUID],
    user_ids: List[uuid.UUID],
) -> None:
    """Delete a batch of entities atomically, in dependency order."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        for proj_id in project_ids:
            await session.execute(delete(ProjectDB).where(ProjectDB.id == proj_id))
        for ws_id in workspace_ids:
            await session.execute(delete(WorkspaceDB).where(WorkspaceDB.id == ws_id))
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
    engine = get_transactions_engine()

    async with engine.session() as session:
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
