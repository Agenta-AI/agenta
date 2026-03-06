export const EVENT_OPTIONS = [
    {
        label: "Config Deployed",
        value: "environments.revisions.committed" as const,
    },
]

export const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

export const PROVIDER_OPTIONS = [
    {
        label: "Webhook",
        value: "webhook",
        description: "Send a POST request to any URL",
    },
    {
        label: "GitHub",
        value: "github",
        description: "Trigger a GitHub Actions workflow",
    },
]

export const GITHUB_HEADERS = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

export const GITHUB_URL_TEMPLATES = {
    repository_dispatch: "https://api.github.com/repos/{repo}/dispatches",
    workflow_dispatch:
        "https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches",
}

export const GITHUB_PAYLOAD_TEMPLATES = {
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
