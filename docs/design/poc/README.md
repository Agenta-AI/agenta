# PR Automation POC

This directory contains a proof-of-concept implementation of the webhook-based PR automation system for Agenta.

## Overview

This POC demonstrates the **Simple Solution (Phase 1)** from the design document: webhook-based integration.

### How It Works

```
┌──────────────┐      Deploy       ┌──────────────┐
│   Agenta     │──────────────────>│   Backend    │
│     UI       │                   │   (emits     │
└──────────────┘                   │   webhook)   │
                                   └──────┬───────┘
                                          │
                                          │ HTTP POST
                                          │ (signed)
                                          ▼
                                   ┌──────────────┐
                                   │   Webhook    │
                                   │   Handler    │
                                   │   (user's)   │
                                   └──────┬───────┘
                                          │
                                          │ GitHub API
                                          ▼
                                   ┌──────────────┐
                                   │   GitHub     │
                                   │  Create PR   │
                                   └──────────────┘
```

## Files

1. **`webhook_emitter.py`**: Backend component integrated into Agenta
   - Emits webhook events when deployments occur
   - Handles signature generation, retry logic, delivery logging
   - Would be integrated into `api/oss/src/services/db_manager.py`

2. **`webhook_handler_example.py`**: User-deployed webhook receiver
   - Receives webhooks from Agenta
   - Verifies signatures for security
   - Creates GitHub PRs using GitHub API
   - Example implementation users can customize

3. **`README.md`**: This file

## Running the POC

### Prerequisites

```bash
pip install httpx flask PyGithub
```

### Step 1: Run the Webhook Handler

The webhook handler is what a user would deploy to receive events from Agenta:

```bash
# Set environment variables
export AGENTA_WEBHOOK_SECRET="my_webhook_secret_key"
export GITHUB_TOKEN="ghp_your_personal_access_token"
export GITHUB_REPO="your-org/your-repo"

# Run the handler
python webhook_handler_example.py
```

The handler will start on `http://localhost:3000`

### Step 2: Run the Event Emitter (Simulates Agenta)

In another terminal, run the emitter to simulate an Agenta deployment:

```bash
python webhook_emitter.py
```

This will:
1. Register a webhook configuration
2. Simulate deploying to production
3. Emit webhook event
4. Deliver to the handler

### Step 3: Observe the Flow

You should see:

**Terminal 1 (Handler)**:
```
📨 Received event: environment.deployed
   Timestamp: 2025-11-20T10:30:00Z
   Delivery ID: delivery_1234567890

🎯 Production deployment detected!
   App: customer-support-bot
   Variant: v2-optimized

📝 Creating GitHub PR...
   Repository: your-org/your-repo
   Base branch: main
   Creating branch: agenta/deploy-customer-support-bot-1234567890

✅ GitHub PR created: https://github.com/your-org/your-repo/pull/123
```

**Terminal 2 (Emitter)**:
```
🚀 Deploying v2-optimized to production...
✅ Deployment successful!

📢 Triggering webhook event...
📤 Emitting event: environment.deployed
   Project: project_abc
   App: customer-support-bot
   Environment: production

✅ Webhook GitHub PR Creator delivered successfully
```

## Example Webhook Payload

Here's what Agenta sends to the webhook handler:

```json
{
  "event": "environment.deployed",
  "timestamp": "2025-11-20T10:30:00Z",
  "delivery_id": "delivery_1234567890",
  "project_id": "project_abc",
  "data": {
    "app_name": "customer-support-bot",
    "variant_name": "v2-optimized",
    "variant_id": "variant_customer-support-bot",
    "environment": "production",
    "revision": 15,
    "commit_message": "Improved response quality",
    "config_diff": {
      "added": {},
      "modified": {
        "temperature": {
          "old": 0.7,
          "new": 0.5
        },
        "system_prompt": {
          "old": "You are a helpful assistant",
          "new": "You are a helpful customer support assistant. Be concise and professional."
        }
      },
      "removed": {}
    },
    "deployed_by": "jane@company.com",
    "deployment_id": "deploy_1234567890"
  }
}
```

## Example PR Created

The webhook handler creates a PR like this:

```markdown
# 🤖 Agenta Deployment: customer-support-bot → production

**Environment**: production
**Application**: customer-support-bot
**Variant**: v2-optimized (revision 15)
**Deployed by**: jane@company.com
**Timestamp**: 2025-11-20 10:30:00 UTC

## Changes

### Modified Parameters

- **temperature**: `0.7` → `0.5`
- **system_prompt**: `You are a helpful assistant` → `You are a helpful customer support assistant. Be concise and professional.`

## Commit Message

> Improved response quality

## Review Checklist

- [ ] Config changes reviewed
- [ ] Deployment tested in staging
- [ ] Rollback plan documented

---

*Automatically generated by Agenta via webhook*
```

## Security Features

### Signature Verification

Every webhook includes an HMAC signature in the `X-Agenta-Signature` header:

```python
signature = hmac.new(
    secret.encode(),
    payload.encode(),
    hashlib.sha256
).hexdigest()
```

The handler verifies this signature to ensure the webhook came from Agenta.

### Best Practices

1. **Use HTTPS**: Always use HTTPS URLs for webhooks in production
2. **Rotate Secrets**: Rotate webhook secrets periodically
3. **Validate Events**: Check event types before processing
4. **Rate Limit**: Implement rate limiting on webhook endpoints
5. **Idempotency**: Use delivery IDs to prevent duplicate processing

## Customization

Users can customize the webhook handler to:

1. **Different VCS**: Adapt for GitLab, Bitbucket, etc.
2. **Custom PR Format**: Change PR title, body, labels
3. **Notifications**: Send to Slack, email, etc.
4. **Validation**: Add custom validation logic
5. **Multiple Repos**: Map different apps to different repos

## Production Deployment

To deploy this in production, users would:

1. **Deploy Handler**: Use Vercel, AWS Lambda, GCP Cloud Run, etc.
2. **Set Environment Variables**: Configure secrets, tokens, repo info
3. **Configure Webhook in Agenta**: Point to deployed handler URL
4. **Test**: Use webhook test feature in Agenta settings
5. **Monitor**: Set up logging and alerting for failures

## Integration with Real GitHub API

To make this actually create PRs, replace the simulated PR creation with real GitHub API calls:

```python
from github import Github

def create_github_pr(deployment: Dict[str, Any]) -> Dict[str, Any]:
    # Initialize GitHub client
    g = Github(GITHUB_TOKEN)
    repo = g.get_repo(GITHUB_REPO)

    # Get base branch reference
    base_ref = repo.get_git_ref(f"heads/{GITHUB_BASE_BRANCH}")
    base_sha = base_ref.object.sha

    # Create new branch
    branch_name = f"agenta/deploy-{deployment['app_name']}-{int(datetime.utcnow().timestamp())}"
    repo.create_git_ref(
        ref=f"refs/heads/{branch_name}",
        sha=base_sha
    )

    # Create/update deployment file
    file_path = f"deployments/{deployment['app_name']}/production.json"
    content = format_deployment_file(deployment)

    try:
        # Try to update existing file
        file = repo.get_contents(file_path, ref=branch_name)
        repo.update_file(
            path=file_path,
            message=f"Deploy {deployment['variant_name']} to production",
            content=content,
            sha=file.sha,
            branch=branch_name
        )
    except:
        # Create new file
        repo.create_file(
            path=file_path,
            message=f"Deploy {deployment['variant_name']} to production",
            content=content,
            branch=branch_name
        )

    # Create pull request
    pr = repo.create_pull(
        title=f"🤖 Deploy {deployment['app_name']} to production",
        body=format_pr_body(deployment),
        head=branch_name,
        base=GITHUB_BASE_BRANCH
    )

    # Add labels
    pr.add_to_labels("agenta-deployment", "production")

    return {
        "success": True,
        "pr_url": pr.html_url,
        "pr_number": pr.number,
        "branch": branch_name
    }
```

## Next Steps

1. **Integrate into Agenta**: Add event emitter to deployment service
2. **Add UI**: Build webhook configuration interface
3. **Database**: Store webhook configs and delivery history
4. **Documentation**: Create user docs for webhook setup
5. **Testing**: Add integration tests
6. **Phase 2**: Build turnkey GitHub integration (no webhook handler needed)

## Questions?

See the main design document: `../pr-automation-design.md`
