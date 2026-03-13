# LinkedIn

Webhooks and GitHub automations are live in Agenta.

You can now trigger an automation when a prompt deployment happens. Send the event to any HTTPS endpoint, or call GitHub directly with `repository_dispatch` or `workflow_dispatch`.

This is useful if you sync deployed prompts into a repo, run CI checks, or open a PR with the latest prompt config after each deployment.

Docs:
- https://agenta.ai/docs/prompt-engineering/integrating-prompts/webhooks
- https://agenta.ai/docs/prompt-engineering/integrating-prompts/github

# Twitter/X

Tweet 1:

Agenta can now trigger webhooks and GitHub Actions when a prompt deployment happens.

Use any HTTPS endpoint, `repository_dispatch`, or `workflow_dispatch` to kick off CI, sync prompt files, or open a PR.

Tweet 2:

Docs:
https://agenta.ai/docs/prompt-engineering/integrating-prompts/webhooks
https://agenta.ai/docs/prompt-engineering/integrating-prompts/github

# Slack

Shipped: webhooks and GitHub automations for prompt deployments.

- Send deployment events to any HTTPS endpoint
- Verify requests with HMAC signatures or use a bearer token
- Trigger GitHub with `repository_dispatch` or `workflow_dispatch`
- Fetch the latest prompt in a workflow and open a PR automatically

Docs:
- https://agenta.ai/docs/prompt-engineering/integrating-prompts/webhooks
- https://agenta.ai/docs/prompt-engineering/integrating-prompts/github
