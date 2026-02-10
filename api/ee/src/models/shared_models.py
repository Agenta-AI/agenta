from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class WorkspaceRole(str, Enum):
    OWNER = "owner"
    VIEWER = "viewer"
    EDITOR = "editor"
    EVALUATOR = "evaluator"
    WORKSPACE_ADMIN = "workspace_admin"
    DEPLOYMENT_MANAGER = "deployment_manager"

    @classmethod
    def is_valid_role(cls, role: str) -> bool:
        return role.upper() in list(WorkspaceRole.__members__.keys())

    @classmethod
    def get_description(cls, role):
        descriptions = {
            cls.OWNER: "Can fully manage the workspace, including adding and removing members.",
            cls.VIEWER: "Can view the workspace content but cannot make changes.",
            cls.EDITOR: "Can edit workspace content, but cannot manage members or roles.",
            cls.EVALUATOR: "Can evaluate models and provide feedback within the workspace.",
            cls.WORKSPACE_ADMIN: "Can manage workspace settings and members but cannot delete the workspace.",
            cls.DEPLOYMENT_MANAGER: "Can manage model deployments within the workspace.",
        }
        return descriptions.get(role, "Description not available, Role not found")


class Permission(str, Enum):
    # general
    READ_SYSTEM = "read_system"

    # App and variants
    VIEW_APPLICATIONS = "view_applications"
    EDIT_APPLICATIONS = "edit_application"

    CREATE_APP_VARIANT = "create_app_variant"
    DELETE_APP_VARIANT = "delete_app_variant"

    MODIFY_VARIANT_CONFIGURATIONS = "modify_variant_configurations"
    EDIT_APPLICATIONS_VARIANT = "delete_application_variant"

    # Service
    RUN_SERVICE = "run_service"

    # Vault Secret
    VIEW_SECRET = "view_secret"
    EDIT_SECRET = "edit_secret"

    # Tracing/Spans
    VIEW_SPANS = "view_spans"
    EDIT_SPANS = "edit_spans"

    # Folders
    VIEW_FOLDERS = "view_folders"
    EDIT_FOLDERS = "edit_folders"

    # API Keys
    VIEW_API_KEYS = "view_api_keys"
    EDIT_API_KEYS = "edit_api_keys"

    # App environment deployment
    VIEW_APP_ENVIRONMENT_DEPLOYMENT = "view_app_environment_deployment"
    EDIT_APP_ENVIRONMENT_DEPLOYMENT = "edit_app_environment_deployment"
    CREATE_APP_ENVIRONMENT_DEPLOYMENT = "create_app_environment_deployment"

    # Testset
    VIEW_TESTSET = "view_testset"
    EDIT_TESTSET = "edit_testset"
    CREATE_TESTSET = "create_testset"
    DELETE_TESTSET = "delete_testset"

    # Evaluation
    VIEW_EVALUATION = "view_evaluation"
    RUN_EVALUATIONS = "run_evaluations"
    EDIT_EVALUATION = "edit_evaluation"
    CREATE_EVALUATION = "create_evaluation"
    DELETE_EVALUATION = "delete_evaluation"

    # Deployment
    DEPLOY_APPLICATION = "deploy_application"

    # Workspace
    VIEW_WORKSPACE = "view_workspace"
    EDIT_WORKSPACE = "edit_workspace"
    CREATE_WORKSPACE = "create_workspace"
    DELETE_WORKSPACE = "delete_workspace"
    MODIFY_USER_ROLES = "modify_user_roles"
    ADD_USER_TO_WORKSPACE = "add_new_user_to_workspace"

    # Organization
    EDIT_ORGANIZATION = "edit_organization"
    DELETE_ORGANIZATION = "delete_organization"
    ADD_USER_TO_ORGANIZATION = "add_new_user_to_organization"

    # User Profile
    RESET_PASSWORD = "reset_password"

    # Billing (Plans, Subscriptions, Usage, etc)
    VIEW_BILLING = "view_billing"
    EDIT_BILLING = "edit_billing"

    # Workflows
    VIEW_WORKFLOWS = "view_workflows"
    EDIT_WORKFLOWS = "edit_workflows"
    RUN_WORKFLOWS = "run_workflows"

    # Evaluators
    VIEW_EVALUATORS = "view_evaluators"
    EDIT_EVALUATORS = "edit_evaluators"

    # Environments
    VIEW_ENVIRONMENTS = "view_environments"
    EDIT_ENVIRONMENTS = "edit_environments"
    DEPLOY_ENVIRONMENTS = "deploy_environments"

    # Queries
    VIEW_QUERIES = "view_queries"
    EDIT_QUERIES = "edit_queries"

    # Testsets
    VIEW_TESTSETS = "view_testsets"
    EDIT_TESTSETS = "edit_testsets"

    # Annotations
    VIEW_ANNOTATIONS = "view_annotations"
    EDIT_ANNOTATIONS = "edit_annotations"

    # Invocations
    VIEW_INVOCATIONS = "view_invocations"
    EDIT_INVOCATIONS = "edit_invocations"

    # Evaluations
    VIEW_EVALUATION_RUNS = "view_evaluation_runs"
    EDIT_EVALUATION_RUNS = "edit_evaluation_runs"

    VIEW_EVALUATION_SCENARIOS = "view_evaluation_scenarios"
    EDIT_EVALUATION_SCENARIOS = "edit_evaluation_scenarios"

    VIEW_EVALUATION_RESULTS = "view_evaluation_results"
    EDIT_EVALUATION_RESULTS = "edit_evaluation_results"

    VIEW_EVALUATION_METRICS = "view_evaluation_metrics"
    EDIT_EVALUATION_METRICS = "edit_evaluation_metrics"

    VIEW_EVALUATION_QUEUES = "view_evaluation_queues"
    EDIT_EVALUATION_QUEUES = "edit_evaluation_queues"

    @classmethod
    def default_permissions(cls, role):
        VIEWER_PERMISSIONS = [
            cls.READ_SYSTEM,
            cls.VIEW_APPLICATIONS,
            cls.VIEW_SECRET,
            cls.VIEW_APP_ENVIRONMENT_DEPLOYMENT,
            cls.VIEW_TESTSET,
            cls.VIEW_EVALUATION,
            cls.RUN_SERVICE,
            cls.VIEW_BILLING,
            #
            cls.VIEW_WORKFLOWS,
            cls.VIEW_EVALUATORS,
            cls.VIEW_QUERIES,
            cls.VIEW_TESTSETS,
            cls.VIEW_ANNOTATIONS,
            cls.VIEW_INVOCATIONS,
            cls.VIEW_SPANS,
            cls.VIEW_FOLDERS,
            cls.VIEW_API_KEYS,
            cls.VIEW_ENVIRONMENTS,
            cls.VIEW_EVALUATION_RUNS,
            cls.VIEW_EVALUATION_SCENARIOS,
            cls.VIEW_EVALUATION_RESULTS,
            cls.VIEW_EVALUATION_METRICS,
            cls.VIEW_EVALUATION_QUEUES,
        ]
        defaults = {
            WorkspaceRole.OWNER: [p for p in cls],
            WorkspaceRole.VIEWER: VIEWER_PERMISSIONS,
            WorkspaceRole.EDITOR: [
                p
                for p in cls
                if p
                not in [
                    cls.RESET_PASSWORD,
                    cls.DELETE_TESTSET,
                    cls.DELETE_WORKSPACE,
                    cls.CREATE_WORKSPACE,
                    cls.EDIT_ORGANIZATION,
                    cls.DELETE_EVALUATION,
                    cls.MODIFY_USER_ROLES,
                    cls.EDIT_APPLICATIONS,
                    cls.DELETE_ORGANIZATION,
                    cls.ADD_USER_TO_WORKSPACE,
                    cls.ADD_USER_TO_ORGANIZATION,
                    cls.EDIT_BILLING,
                    cls.DEPLOY_ENVIRONMENTS,
                ]
            ],
            WorkspaceRole.DEPLOYMENT_MANAGER: VIEWER_PERMISSIONS
            + [cls.DEPLOY_APPLICATION, cls.DEPLOY_ENVIRONMENTS, cls.EDIT_ENVIRONMENTS],
            WorkspaceRole.WORKSPACE_ADMIN: [
                p
                for p in cls
                if p
                not in [
                    cls.DELETE_WORKSPACE,
                    cls.DELETE_ORGANIZATION,
                    cls.EDIT_ORGANIZATION,
                    cls.ADD_USER_TO_ORGANIZATION,
                    cls.EDIT_BILLING,
                ]
            ],
            WorkspaceRole.EVALUATOR: VIEWER_PERMISSIONS
            + [cls.CREATE_EVALUATION, cls.RUN_EVALUATIONS],
        }

        return defaults.get(role, [])


class WorkspaceMember(BaseModel):
    role_name: WorkspaceRole
    permissions: List[Permission] = Field(default_factory=list)
