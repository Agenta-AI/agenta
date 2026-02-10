from typing import Optional, List, Dict
from uuid import UUID, uuid4
from traceback import print_exc
import random
import string

from pydantic import BaseModel

from fastapi.responses import JSONResponse

from oss.src.utils.common import APIRouter, is_ee

from oss.src.services.user_service import create_new_user
from oss.src.services.api_key_service import create_api_key

if is_ee():
    from ee.src.core.meters.service import MetersService
    from ee.src.dbs.postgres.meters.dao import MetersDAO
    from ee.src.core.subscriptions.types import SubscriptionDTO
    from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO
    from ee.src.core.subscriptions.service import SubscriptionsService

    from ee.src.core.subscriptions.types import Plan

if is_ee():
    from ee.src.services.admin_manager import (
        Reference,
        #
        UserRequest,
        #
        OrganizationRequest,
        WorkspaceRequest,
        ProjectRequest,
        #
        OrganizationMembershipRequest,
        WorkspaceMembershipRequest,
        ProjectMembershipRequest,
        #
        ProjectRole,
        #
        Credentials,
        #
        check_user,
        #
        create_user,
        #
        create_organization,
        create_workspace,
        create_project,
        #
        create_organization_membership,
        create_workspace_membership,
        create_project_membership,
        #
        create_credentials,
    )

    from ee.src.models.api.organization_models import CreateOrganization

    from ee.src.services.selectors import user_exists

    from ee.src.services.db_manager_ee import (
        fetch_project_memberships_by_user_id,
        create_organization as legacy_create_organization,
    )

else:
    from oss.src.services.admin_manager import (
        Reference,
        #
        UserRequest,
        #
        OrganizationRequest,
        WorkspaceRequest,
        ProjectRequest,
        #
        ProjectRole,
        #
        Credentials,
        #
        check_user,
        #
        create_user,
        #
        create_organization,
        create_workspace,
        create_project,
        #
        create_credentials,
    )

    from oss.src.services.admin_manager import CreateOrganization
    from oss.src.services.admin_manager import user_exists
    from oss.src.services.admin_manager import legacy_create_organization

router = APIRouter()


if is_ee():

    class EntitiesRequestModel(BaseModel):
        users: Dict[str, UserRequest]
        #
        organizations: Dict[str, OrganizationRequest]
        workspaces: Dict[str, WorkspaceRequest]
        projects: Dict[str, ProjectRequest]
        #
        organization_memberships: Dict[str, OrganizationMembershipRequest]
        workspace_memberships: Dict[str, WorkspaceMembershipRequest]
        project_memberships: Dict[str, ProjectMembershipRequest]

else:

    class EntitiesRequestModel(BaseModel):
        users: Dict[str, UserRequest]
        #
        organizations: Dict[str, OrganizationRequest]
        workspaces: Dict[str, WorkspaceRequest]
        projects: Dict[str, ProjectRequest]


class ProjectScope(BaseModel):
    credentials: Credentials
    role: ProjectRole
    # role: Union[OrganizationRole, WorkspaceRole, ProjectRole]
    #
    user: Reference
    project: Reference
    workspace: Reference
    organization: Reference


class ScopesResponseModel(BaseModel):
    projects: Dict[str, Dict[str, ProjectScope]] = {}
    # workspaces: Dict[str, Dict[str, WorkspaceScope]] = {}
    # organizations: Dict[str, Dict[str, OrganizationScope]] = {}


class ReferenceTracker(BaseModel):
    users: Dict[str, UUID] = {}
    #
    organizations: Dict[str, UUID] = {}
    workspaces: Dict[str, UUID] = {}
    projects: Dict[str, UUID] = {}
    #
    organization_memberships: Dict[str, UUID] = {}
    workspace_memberships: Dict[str, UUID] = {}
    project_memberships: Dict[str, UUID] = {}


@router.post(
    "/accounts",
    operation_id="create_accounts",
    response_model=ScopesResponseModel,
)
async def create_accounts(
    entities: EntitiesRequestModel,
):
    try:
        references = ReferenceTracker()
        scopes = ScopesResponseModel()

        # 1. MANAGE USERS
        for slug, request in entities.users.items():
            # MAKE USER REFERENCE
            reference = Reference(slug=slug)
            # CHECK USER DUPLICATE
            ref = await check_user(request=request)
            # CREATE USER ENTITY
            if not ref:
                ref = await create_user(request=request)
            # TRACK USER REFERENCE
            references.users[reference.slug] = ref.id

        # 2.1. MANAGE ORGANIZATIONS
        for slug, request in entities.organizations.items():
            # MAKE ORGANIZATION REFERENCE
            reference = Reference(slug=slug)
            # CREATE ORGANIZATION ENTITY
            ref = await create_organization(request=request)
            # TRACK ORGANIZATION REFERENCE
            references.organizations[reference.slug] = ref.id

        # 2.2. MANAGE WORKSPACES
        for slug, request in entities.workspaces.items():
            # MAKE WORKSPACE REFERENCE
            reference = Reference(slug=slug)
            # FIX ORGANIZATION REFERENCE
            request.organization_ref = Reference(
                slug=request.organization_ref.slug,
                id=references.organizations[request.organization_ref.slug],
            )
            # CREATE WORKSPACE ENTITY
            ref = await create_workspace(request=request)
            # TRACK WORKSPACE REFERENCE
            references.workspaces[reference.slug] = ref.id

        # 2.3. MANAGE PROJECTS
        for slug, request in entities.projects.items():
            # MAKE PROJECT REFERENCE
            reference = Reference(slug=slug)
            # FIX ORGANIZATION REFERENCE
            request.organization_ref = Reference(
                slug=request.organization_ref.slug,
                id=references.organizations[request.organization_ref.slug],
            )
            # FIX WORKSPACE REFERENCE
            request.workspace_ref = Reference(
                slug=request.workspace_ref.slug,
                id=references.workspaces[request.workspace_ref.slug],
            )
            # CREATE PROJECT ENTITY
            ref = await create_project(request=request)
            # TRACK PROJECT REFERENCE
            references.projects[reference.slug] = ref.id

        if is_ee():
            # 3.1. MANAGE ORGANIZATION MEMBERSHIPS
            for slug, request in entities.organization_memberships.items():
                # MAKE ORGANIZATION MEMBERSHIP REFERENCE
                reference = Reference(slug=slug)
                # FIX ORGANIZATION REFERENCE
                request.organization_ref = Reference(
                    slug=request.organization_ref.slug,
                    id=references.organizations[request.organization_ref.slug],
                )
                # FIX USER REFERENCE
                request.user_ref = Reference(
                    slug=request.user_ref.slug,
                    id=references.users[request.user_ref.slug],
                )
                # CREATE ORGANIZATION MEMBERSHIP ENTITY
                ref = await create_organization_membership(request=request)
                # TRACK ORGANIZATION MEMBERSHIP REFERENCE
                references.organization_memberships[reference.slug] = ref.id

            # 3.2. MANAGE WORKSPACE MEMBERSHIPS
            for slug, request in entities.workspace_memberships.items():
                # MAKE WORKSPACE MEMBERSHIP REFERENCE
                reference = Reference(slug=slug)
                # FIX WORKSPACE REFERENCE
                request.workspace_ref = Reference(
                    slug=request.workspace_ref.slug,
                    id=references.workspaces[request.workspace_ref.slug],
                )
                # FIX USER REFERENCE
                request.user_ref = Reference(
                    slug=request.user_ref.slug,
                    id=references.users[request.user_ref.slug],
                )
                # CREATE WORKSPACE MEMBERSHIP ENTITY
                ref = await create_workspace_membership(request=request)
                # TRACK WORKSPACE MEMBERSHIP REFERENCE
                references.workspace_memberships[reference.slug] = ref.id

            # 3.3. MANAGE PROJECT MEMBERSHIPS
            for slug, request in entities.project_memberships.items():
                # MAKE PROJECT MEMBERSHIP REFERENCE
                reference = Reference(slug=slug)
                # FIX PROJECT REFERENCE
                request.project_ref = Reference(
                    slug=request.project_ref.slug,
                    id=references.projects[request.project_ref.slug],
                )
                # FIX USER REFERENCE
                request.user_ref = Reference(
                    slug=request.user_ref.slug,
                    id=references.users[request.user_ref.slug],
                )
                # CREATE PROJECT MEMBERSHIP ENTITY
                ref = await create_project_membership(request=request)
                # TRACK PROJECT MEMBERSHIP REFERENCE
                references.project_memberships[reference.slug] = ref.id

            # 4. MANAGE SCOPES
            for reference, request in entities.project_memberships.items():
                # CREATE CREDENTIALS
                credentials = await create_credentials(
                    user_id=references.users[request.user_ref.slug],
                    project_id=references.projects[request.project_ref.slug],
                )
                # GET WORKSPACE AND ORGANIZATION
                project = entities.projects[request.project_ref.slug]
                workspace = entities.workspaces[project.workspace_ref.slug]
                _organization = entities.organizations[workspace.organization_ref.slug]
                # CREATE PROJECT SCOPE
                scope = ProjectScope(
                    credentials=credentials,
                    role=request.role,
                    #
                    user=request.user_ref,
                    project=request.project_ref,
                    workspace=project.workspace_ref,
                    organization=workspace.organization_ref,
                )
                # INITIALIZE PROJECT SCOPES
                if request.user_ref.slug not in scopes.projects:
                    scopes.projects[request.user_ref.slug] = {}
                if (
                    request.project_ref.slug
                    not in scopes.projects[request.user_ref.slug]
                ):
                    scopes.projects[request.user_ref.slug][
                        request.project_ref.slug
                    ] = {}
                # TRACK PROJECT SCOPE
                scopes.projects[request.user_ref.slug][request.project_ref.slug] = scope

        return scopes

    except Exception:  # pylint: disable=bare-except
        print_exc()

        return JSONResponse(
            status_code=500,
            content="Could not create accounts.",
        )


class LegacyUserRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class LegacyScopeRequest(BaseModel):
    name: Optional[str] = None


class LegacySubscriptionRequest(BaseModel):
    plan: Optional[str] = None


class AccountRequest(BaseModel):
    user: Optional[LegacyUserRequest] = None
    scope: Optional[LegacyScopeRequest] = None
    subscription: Optional[LegacySubscriptionRequest] = None


class LegacyUserResponse(BaseModel):
    id: Optional[UUID] = None


class LegacyScopesResponse(BaseModel):
    organization_id: Optional[UUID] = None
    organization_name: Optional[str] = None

    workspace_id: Optional[UUID] = None
    workspace_name: Optional[str] = None

    project_id: Optional[UUID] = None
    project_name: Optional[str] = None
    is_demo: Optional[bool] = None

    user_role: Optional[str] = None

    credentials: Optional[str] = None


class AccountResponse(BaseModel):
    user: Optional[LegacyUserResponse] = None
    scopes: Optional[List[LegacyScopesResponse]] = None


if is_ee():
    subscription_service = SubscriptionsService(
        subscriptions_dao=SubscriptionsDAO(),
        meters_service=MetersService(
            meters_dao=MetersDAO(),
        ),
    )


@router.post(
    "/account",
    operation_id="create_account",
    response_model=AccountResponse,
)
async def create_account(
    account: Optional[AccountRequest] = None,
):
    prefix = "".join(random.choices(string.ascii_letters + string.digits, k=8))

    if not account:
        account = AccountRequest()

    if not account.user:
        account.user = LegacyUserRequest()

    if not account.user.name:
        account.user.name = prefix

    if not account.user.email:
        account.user.email = prefix + "@test.agenta.ai"

    if not account.scope:
        account.scope = LegacyScopeRequest()

    if not account.scope.name:
        account.scope.name = prefix

    if not account.subscription:
        account.subscription = LegacySubscriptionRequest()

    if is_ee():
        if not account.subscription.plan:
            account.subscription.plan = Plan.CLOUD_V0_HOBBY

    try:
        user_db = None

        exists = await user_exists(
            user_email=account.user.email,
        )

        if exists:
            return JSONResponse(
                status_code=409,
                content="Already exists.",
            )

        user_db = await create_new_user(
            payload={
                "uid": str(uuid4()),
                "username": account.user.name,
                "email": account.user.email,
            }
        )

        user = LegacyUserResponse(id=str(user_db.id))

        create_org_payload = CreateOrganization(
            name="Organization",
            #
            is_demo=False,
            #
            owner_id=UUID(str(user_db.id)),
        )

        organization_db, workspace_db, project_db = await legacy_create_organization(
            create_org_payload,
            user_db,
            return_org_wrk_prj=True,
        )

        if is_ee():
            subscription = SubscriptionDTO(
                organization_id=organization_db.id,
                plan=account.subscription.plan,
                active=True,
                anchor=1,
            )

            subscription = await subscription_service.create(
                subscription=subscription,
            )

        # await add_user_to_demos(
        #     str(user.id),
        # )

        scopes = []

        if is_ee():
            _project_memberships = await fetch_project_memberships_by_user_id(
                user_id=str(user.id),
            )

            if not _project_memberships:
                return JSONResponse(
                    status_code=404,
                    content={"message": "No scopes found."},
                )

            for project_membership in _project_memberships:
                credentials = await create_api_key(
                    user_id=str(user.id),
                    project_id=str(project_membership.project.id),
                )

                scope = LegacyScopesResponse(
                    organization_id=project_membership.project.organization.id,
                    organization_name=project_membership.project.organization.name,
                    workspace_id=project_membership.project.workspace.id,
                    workspace_name=project_membership.project.workspace.name,
                    project_id=project_membership.project.id,
                    project_name=project_membership.project.project_name,
                    is_demo=project_membership.is_demo,
                    user_role=project_membership.role,
                    credentials=f"ApiKey {credentials}",
                )

                scopes.append(scope)
        else:
            credentials = await create_api_key(
                user_id=str(user.id),
                project_id=str(project_db.id),
            )

            scope = LegacyScopesResponse(
                organization_id=organization_db.id,
                organization_name=organization_db.name,
                workspace_id=workspace_db.id,
                workspace_name=workspace_db.name,
                project_id=project_db.id,
                project_name=project_db.project_name,
                is_demo=False,  # Default to False, adjust if needed
                user_role="owner",  # Default to owner, adjust if needed
                credentials=f"ApiKey {credentials}",
            )

            scopes = [scope]

        account = AccountResponse(
            user=user,
            scopes=scopes,
        )

        return account

    except Exception:  # pylint: disable=bare-except
        print_exc()

        return JSONResponse(
            status_code=404,
            content="Could not create account.",
        )
