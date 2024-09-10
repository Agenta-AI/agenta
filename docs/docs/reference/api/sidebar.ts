import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebar: SidebarsConfig = {
  apisidebar: [
    {
      type: "doc",
      id: "reference/api/agenta-backend",
    },
    {
      type: "category",
      label: "Variants",
      link: {
        type: "doc",
        id: "reference/api/variants",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/add-variant-from-base-and-config",
          label: "Add Variant From Base And Config",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/get-variant",
          label: "Get Variant",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/start-variant",
          label: "Start Variant",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/remove-variant",
          label: "Remove Variant",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/update-variant-parameters",
          label: "Update Variant Parameters",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/update-variant-image",
          label: "Update Variant Image",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/retrieve-variant-logs",
          label: "Retrieve Variant Logs",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/get-variant-revisions",
          label: "Get Variant Revisions",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/get-variant-revision",
          label: "Get Variant Revision",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Evaluations",
      link: {
        type: "doc",
        id: "reference/api/evaluations",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/fetch-evaluation-ids-evaluations-by-resource-get",
          label: "Fetch Evaluation Ids",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/fetch-list-evaluations-evaluations-get",
          label: "Fetch List Evaluations",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/create-evaluation",
          label: "Create Evaluation",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/delete-evaluations",
          label: "Delete Evaluations",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/fetch-evaluation-status",
          label: "Fetch Evaluation Status",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/fetch-evaluation-results",
          label: "Fetch Evaluation Results",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/fetch-evaluation-scenarios",
          label: "Fetch Evaluation Scenarios",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/fetch-evaluation",
          label: "Fetch Evaluation",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/webhook-example-fake",
          label: "Webhook Example Fake",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/fetch-evaluation-scenarios-evaluations-evaluation-scenarios-comparison-results-get",
          label: "Fetch Evaluation Scenarios",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Evaluators",
      link: {
        type: "doc",
        id: "reference/api/evaluators",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/get-evaluators-endpoint-evaluators-get",
          label: "Get Evaluators Endpoint",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/get-evaluator-configs-evaluators-configs-get",
          label: "Get Evaluator Configs",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/create-new-evaluator-config-evaluators-configs-post",
          label: "Create New Evaluator Config",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/get-evaluator-config-evaluators-configs-evaluator-config-id-get",
          label: "Get Evaluator Config",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/update-evaluator-config-evaluators-configs-evaluator-config-id-put",
          label: "Update Evaluator Config",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/delete-evaluator-config-evaluators-configs-evaluator-config-id-delete",
          label: "Delete Evaluator Config",
          className: "api-method delete",
        },
      ],
    },
    {
      type: "category",
      label: "Apps",
      link: {
        type: "doc",
        id: "reference/api/apps",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/list-app-variants",
          label: "List App Variants",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/get-variant-by-env",
          label: "Get Variant By Env",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/list-apps",
          label: "List Apps",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/create-app",
          label: "Create App",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/add-variant-from-image",
          label: "Add Variant From Image",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/remove-app",
          label: "Remove App",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/create-app-and-variant-from-template",
          label: "Create App And Variant From Template",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/list-environments",
          label: "List Environments",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/environment-revisions",
          label: "List App Environment Revisions",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Human-Evaluations",
      link: {
        type: "doc",
        id: "reference/api/human-evaluations",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/fetch-list-human-evaluations-human-evaluations-get",
          label: "Fetch List Human Evaluations",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/create-evaluation",
          label: "Create Evaluation",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/delete-evaluations-human-evaluations-delete",
          label: "Delete Evaluations",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/fetch-human-evaluation-human-evaluations-evaluation-id-get",
          label: "Fetch Human Evaluation",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/update-human-evaluation",
          label: "Update Human Evaluation",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/fetch-evaluation-scenarios",
          label: "Fetch Evaluation Scenarios",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/update-evaluation-scenario-router-human-evaluations-evaluation-id-evaluation-scenario-evaluation-scenario-id-evaluation-type-put",
          label: "Update Evaluation Scenario Router",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/get-evaluation-scenario-score-router-human-evaluations-evaluation-scenario-evaluation-scenario-id-score-get",
          label: "Get Evaluation Scenario Score Router",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/update-evaluation-scenario-score-router-human-evaluations-evaluation-scenario-evaluation-scenario-id-score-put",
          label: "Update Evaluation Scenario Score Router",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/fetch-results",
          label: "Fetch Results",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Testsets",
      link: {
        type: "doc",
        id: "reference/api/testsets",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/upload-file",
          label: "Upload File",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/import-testset",
          label: "Import Testset",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/create-testset",
          label: "Create Testset",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/get-single-testset",
          label: "Get Single Testset",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/update-testset",
          label: "Update Testset",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/get-testsets",
          label: "Get Testsets",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/delete-testsets",
          label: "Delete Testsets",
          className: "api-method delete",
        },
      ],
    },
    {
      type: "category",
      label: "Containers",
      link: {
        type: "doc",
        id: "reference/api/containers",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/build-image",
          label: "Build Image",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/restart-container",
          label: "Restart Docker Container",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/container-templates",
          label: "Container Templates",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/construct-app-container-url",
          label: "Construct App Container Url",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Environments",
      link: {
        type: "doc",
        id: "reference/api/environments",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/deploy-to-environment",
          label: "Deploy To Environment",
          className: "api-method post",
        },
      ],
    },
    {
      type: "category",
      label: "Observability",
      link: {
        type: "doc",
        id: "reference/api/observability",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/observability-dashboard",
          label: "Get Dashboard Data",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/create-traces",
          label: "Create Traces",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/get-traces",
          label: "Get Traces",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/delete-traces",
          label: "Delete Traces",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/get-trace-detail",
          label: "Get Trace Detail",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/get-spans-of-generation",
          label: "Get Spans Of Trace",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/delete-spans-of-trace",
          label: "Delete Spans Of Trace",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/get-span-of-generation",
          label: "Get Span Of Trace",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Bases",
      link: {
        type: "doc",
        id: "reference/api/bases",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/list-bases",
          label: "List Bases",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Configs",
      link: {
        type: "doc",
        id: "reference/api/configs",
      },
      items: [
        {
          type: "doc",
          id: "reference/api/get-config",
          label: "Get Config",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/save-config",
          label: "Save Config",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/get-config-deployment-revision",
          label: "Get Config Deployment Revision",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/revert-deployment-revision",
          label: "Revert Deployment Revision",
          className: "api-method post",
        },
      ],
    },
    {
      type: "category",
      label: "UNTAGGED",
      items: [
        {
          type: "doc",
          id: "reference/api/list-api-keys",
          label: "List Api Keys",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/create-api-key",
          label: "Create Api Key",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/delete-api-key",
          label: "Delete Api Key",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/validate-api-key",
          label: "Validate Api Key",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/list-organizations",
          label: "List Organizations",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/create-organization",
          label: "Create Organization",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/get-own-org",
          label: "Get User Organization",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/fetch-organization-details",
          label: "Fetch Organization Details",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/update-organization",
          label: "Update Organization",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/invite-user-to-workspace",
          label: "Invite User To Workspace",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/resend-invitation",
          label: "Resend Workspace Invitation",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/accept-invitation",
          label: "Accept Workspace Invitation",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/create-workspace",
          label: "Create Workspace",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/update-workspace",
          label: "Update Workspace",
          className: "api-method put",
        },
        {
          type: "doc",
          id: "reference/api/get-all-workspace-roles",
          label: "Get All Workspace Roles",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/get-all-workspace-permissions",
          label: "Get All Workspace Permissions",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/assign-role-to-user",
          label: "Assign Role To User",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "reference/api/unassign-role-from-user",
          label: "Unassign Role From User",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/remove-user-from-workspace",
          label: "Remove User From Workspace",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "reference/api/health-check",
          label: "Health Check",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "reference/api/user-profile",
          label: "User Profile",
          className: "api-method get",
        },
      ],
    },
  ],
};

export default sidebar.apisidebar;
