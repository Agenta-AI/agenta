import {GithubOutlined, LinkOutlined} from "@ant-design/icons"

import {AutomationSchemaEntry} from "../assets/types"

export const EVENT_OPTIONS = [
    {
        label: "Configuration Deployed",
        value: "environments.revisions.committed" as const,
    },
]

export const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

export const GITHUB_HEADERS: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

export const GITHUB_URL_TEMPLATES: Record<string, string> = {
    repository_dispatch: "https://api.github.com/repos/{repo}/dispatches",
    workflow_dispatch:
        "https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches",
}

export const GITHUB_PAYLOAD_TEMPLATES: Record<string, Record<string, unknown>> = {
    repository_dispatch: {
        event_type: "$.event.event_type",
        client_payload: "$.event",
    },
    workflow_dispatch: {
        ref: "{branch}",
        inputs: {
            event_id: "$.event.event_id",
            event_type: "$.event.event_type",
            timestamp: "$.event.timestamp",
            subscription_id: "$.subscription.id",
            project_id: "$.scope.project_id",
        },
    },
}

export const AUTOMATION_SCHEMA: AutomationSchemaEntry[] = [
    {
        provider: "webhook",
        label: "Webhook",
        icon: LinkOutlined,
        description: "Send a POST request to any URL",
        subtitle: "Webhook configuration",
        fields: [
            {
                key: "url",
                label: "Target URL",
                component: "input",
                placeholder: "https://example.com/webhook",
                rules: [
                    {required: true, message: "Payload URL is required"},
                    {type: "url", message: "Please enter a valid URL (e.g. https://...)"},
                    {
                        pattern: /^https:\/\//,
                        message: "URL must use HTTPS",
                    },
                ],
            },
            {
                key: "auth_mode",
                label: "Authentication Mode",
                component: "select",
                initialValue: "signature",
                extraByValue: {
                    signature: "Computed HMAC signature sent in the X-Agenta-Signature header.",
                },
                options: [
                    {label: "Signature (HMAC)", value: "signature"},
                    {label: "Header", value: "authorization"},
                ],
            },
            {
                key: "auth_value",
                label: "Secret",
                component: "input.password",
                secret: true,
                required: true,
                placeholder: "your-secret",
                extra: "This secret will be sent in the Authorization header as 'Authorization: <secret>'",
                visibleWhen: {field: "auth_mode", value: "authorization"},
            },
            {
                key: "header_list",
                label: "",
                component: "headers",
            },
        ],
    },
    {
        provider: "github",
        label: "GitHub",
        icon: GithubOutlined,
        description: "Trigger a GitHub Actions workflow",
        subtitle: "GitHub configuration",
        headers: GITHUB_HEADERS,
        urlTemplates: GITHUB_URL_TEMPLATES,
        payloadTemplates: GITHUB_PAYLOAD_TEMPLATES,
        fields: [
            {
                key: "github_sub_type",
                label: "Trigger",
                component: "select",
                initialValue: "repository_dispatch",
                placeholder: "Select dispatch",
                disabled: "editMode",
                options: [
                    {label: "Repository Dispatch", value: "repository_dispatch"},
                    {label: "Workflow Dispatch", value: "workflow_dispatch"},
                ],
            },
            {
                key: "alert",
                label: "",
                component: "alert",
            },
            {
                key: "github_repo",
                label: "Repository",
                component: "input",
                placeholder: "owner/repo",
                extra: "e.g. Agenta-AI/agenta",
                rules: [
                    {required: true, message: "Repository is required"},
                    {
                        pattern: REPO_PATTERN,
                        message: "Repository must format as 'owner/repo'",
                    },
                ],
            },
            {
                key: "github_workflow",
                label: "Workflow File",
                component: "input",
                placeholder: "workflow.yml",
                extra: "e.g. deploy.yml or action.yaml",
                rules: [{required: true, message: "Workflow file name is required"}],
                visibleWhen: {field: "github_sub_type", value: "workflow_dispatch"},
            },
            {
                key: "github_branch",
                label: "Branch/Ref",
                component: "input",
                initialValue: "main",
                placeholder: "main",
                extra: "The git ref to run the workflow on.",
                rules: [{required: true, message: "Branch name is required"}],
                visibleWhen: {field: "github_sub_type", value: "workflow_dispatch"},
            },
            {
                key: "github_pat",
                label: "Personal Access Token",
                component: "input.password",
                secret: true,
                required: true,
                placeholder: "ghp_...",
                extra: "Used to authenticate with the GitHub API",
            },
        ],
    },
]
