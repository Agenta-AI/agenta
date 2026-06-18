from enum import Enum


class DefaultRole(str, Enum):
    """Code-default role catalog (the roles Agenta ships with).

    Used at all three scopes (organization / workspace / project) to seed the
    default role catalog and their permission mappings. Env overrides
    (`AGENTA_ACCESS_ROLES`) may add or customize roles on top of these.

    The minimal subset that must always exist in every scope is `RequiredRole`.
    """

    OWNER = "owner"
    ADMIN = "admin"
    DEVELOPER = "developer"
    EDITOR = "editor"
    ANNOTATOR = "annotator"
    VIEWER = "viewer"

    @classmethod
    def is_valid_role(cls, role: str) -> bool:
        return role.upper() in list(DefaultRole.__members__.keys())

    @classmethod
    def get_description(cls, role):
        descriptions = {
            cls.OWNER: "Can fully manage the workspace, including adding and removing members.",
            cls.ADMIN: "Can manage workspace settings and members but cannot delete the workspace.",
            cls.DEVELOPER: "Can deploy, export, and manage API keys and environments.",
            cls.EDITOR: "Can edit prompts, testsets, evaluators, and workflows.",
            cls.ANNOTATOR: "Can run evaluations and annotate traces.",
            cls.VIEWER: "Can view the workspace content but cannot make changes.",
        }
        return descriptions.get(role, "Description not available, Role not found")


class RequiredRole(str, Enum):
    """Required role slugs per scope (the minimal guaranteed subset).

    `owner`, `admin`, and `viewer` must exist in every scope (organization,
    workspace, project) — they are merged in by the access-controls builder
    regardless of `AGENTA_ACCESS_ROLES` content, so application code can depend
    on these three slugs being valid in any scope.

    The rationale for the minimal set: `owner` is the single full-access owner,
    `admin` is full access that can be granted to many people, and `viewer` is
    minimal (read-only) access for many people. Without `admin` in the minimal
    set, an env override could leave a scope with only owner + viewer — where no
    non-owner can actually do anything.

    Env overrides may customize the permissions of these roles or add
    additional roles, but cannot remove them.
    """

    OWNER = "owner"
    ADMIN = "admin"
    VIEWER = "viewer"


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

    # Webhooks
    VIEW_WEBHOOKS = "view_webhooks"
    EDIT_WEBHOOKS = "edit_webhooks"

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

    # Events
    VIEW_EVENTS = "view_events"

    # Tools
    VIEW_TOOLS = "view_tools"
    EDIT_TOOLS = "edit_tools"
    RUN_TOOLS = "run_tools"

    # Triggers
    VIEW_TRIGGERS = "view_triggers"
    EDIT_TRIGGERS = "edit_triggers"
    RUN_TRIGGERS = "run_triggers"

    @classmethod
    def default_permissions(cls, role):
        VIEWER_PERMISSIONS = [
            cls.READ_SYSTEM,
            cls.VIEW_APPLICATIONS,
            cls.VIEW_SECRET,
            cls.VIEW_WEBHOOKS,
            cls.VIEW_APP_ENVIRONMENT_DEPLOYMENT,
            cls.VIEW_TESTSET,
            cls.VIEW_EVALUATION,
            cls.RUN_SERVICE,
            cls.VIEW_BILLING,
            cls.VIEW_WORKFLOWS,
            cls.VIEW_EVALUATORS,
            cls.VIEW_QUERIES,
            cls.VIEW_TESTSETS,
            cls.VIEW_ANNOTATIONS,
            cls.VIEW_INVOCATIONS,
            cls.VIEW_SPANS,
            cls.VIEW_FOLDERS,
            cls.VIEW_ENVIRONMENTS,
            cls.VIEW_EVALUATION_RUNS,
            cls.VIEW_EVALUATION_SCENARIOS,
            cls.VIEW_EVALUATION_RESULTS,
            cls.VIEW_EVALUATION_METRICS,
            cls.VIEW_EVALUATION_QUEUES,
            cls.VIEW_TOOLS,
            cls.VIEW_TRIGGERS,
        ]
        ANNOTATOR_PERMISSIONS = VIEWER_PERMISSIONS + [
            cls.CREATE_EVALUATION,
            cls.RUN_EVALUATIONS,
            cls.EDIT_EVALUATION,
            cls.EDIT_ANNOTATIONS,
            cls.EDIT_EVALUATION_RUNS,
            cls.EDIT_EVALUATION_SCENARIOS,
            cls.EDIT_EVALUATION_RESULTS,
            cls.EDIT_EVALUATION_METRICS,
            cls.EDIT_EVALUATION_QUEUES,
            cls.EDIT_SPANS,
            cls.RUN_TOOLS,
            cls.RUN_TRIGGERS,
        ]
        EDITOR_PERMISSIONS = ANNOTATOR_PERMISSIONS + [
            cls.EDIT_APPLICATIONS,
            cls.CREATE_APP_VARIANT,
            cls.DELETE_APP_VARIANT,
            cls.MODIFY_VARIANT_CONFIGURATIONS,
            cls.EDIT_APPLICATIONS_VARIANT,
            cls.EDIT_WEBHOOKS,
            cls.EDIT_SECRET,
            cls.EDIT_FOLDERS,
            cls.EDIT_TESTSET,
            cls.CREATE_TESTSET,
            cls.DELETE_TESTSET,
            cls.DELETE_EVALUATION,
            cls.EDIT_WORKFLOWS,
            cls.RUN_WORKFLOWS,
            cls.EDIT_EVALUATORS,
            cls.EDIT_QUERIES,
            cls.EDIT_TESTSETS,
            cls.EDIT_INVOCATIONS,
            cls.EDIT_TOOLS,
            cls.EDIT_TRIGGERS,
        ]
        DEVELOPER_PERMISSIONS = EDITOR_PERMISSIONS + [
            cls.VIEW_API_KEYS,
            cls.EDIT_API_KEYS,
            cls.DEPLOY_APPLICATION,
            cls.DEPLOY_ENVIRONMENTS,
            cls.EDIT_ENVIRONMENTS,
            cls.EDIT_APP_ENVIRONMENT_DEPLOYMENT,
            cls.CREATE_APP_ENVIRONMENT_DEPLOYMENT,
            cls.VIEW_EVENTS,
        ]
        ADMIN_PERMISSIONS = DEVELOPER_PERMISSIONS + [
            cls.EDIT_WORKSPACE,
            cls.CREATE_WORKSPACE,
            cls.MODIFY_USER_ROLES,
            cls.ADD_USER_TO_WORKSPACE,
            cls.RESET_PASSWORD,
            cls.VIEW_WORKSPACE,
        ]
        defaults = {
            DefaultRole.OWNER: [p for p in cls],
            DefaultRole.ADMIN: ADMIN_PERMISSIONS,
            DefaultRole.DEVELOPER: DEVELOPER_PERMISSIONS,
            DefaultRole.EDITOR: EDITOR_PERMISSIONS,
            DefaultRole.ANNOTATOR: ANNOTATOR_PERMISSIONS,
            DefaultRole.VIEWER: VIEWER_PERMISSIONS,
        }

        return defaults.get(role, [])
