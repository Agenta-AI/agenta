# PR Automation Design Document

## Executive Summary

This document proposes a feature to automatically create GitHub Pull Requests when prompts/configurations are deployed to production in Agenta. This provides an audit trail, compliance documentation, and team visibility for production changes.

**Version**: 1.0
**Status**: Design Proposal
**Last Updated**: 2025-11-20

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [User Personas & Use Cases](#user-personas--use-cases)
3. [Solution Approaches](#solution-approaches)
4. [MVP Recommendation](#mvp-recommendation)
5. [Technical Architecture](#technical-architecture)
6. [Configuration & User Experience](#configuration--user-experience)
7. [Compliance & Security](#compliance--security)
8. [Implementation Phases](#implementation-phases)
9. [Open Questions](#open-questions)

---

## Problem Statement

### Current State

In Agenta today:
- Users deploy prompts/configs to production through the UI
- Changes are tracked internally (AppEnvironmentRevisionDB) with commit messages
- **No external documentation** of what's deployed in version control
- **No PR review process** for production changes
- **No GitHub integration** for audit trails

### Pain Points

1. **Audit & Compliance**: No external record of production changes for compliance requirements
2. **Team Visibility**: Team members don't see what's deployed via GitHub notifications
3. **Documentation Gap**: Prompt changes aren't versioned alongside code
4. **Review Process**: No formal review/approval workflow for production deployments
5. **Rollback Complexity**: Reverting changes requires knowing Agenta history, not Git history

### Goals

1. **Document all production deployments** in GitHub automatically
2. **Enable team visibility** through PR notifications and review
3. **Support compliance** requirements for change management
4. **Maintain simplicity** for users (minimal configuration)
5. **Provide audit trail** linking deployments to Git history

---

## User Personas & Use Cases

### Persona 1: AI Engineer (Solo)

**Profile**: Individual developer building an LLM app
**Needs**: Simple setup, minimal overhead, basic documentation
**Use Case**:
- Deploys prompt changes to production via Agenta UI
- Wants Git history of what was deployed without manual work
- Doesn't need complex approval workflows

### Persona 2: ML Team (Small Team)

**Profile**: 3-5 person team collaborating on LLM applications
**Needs**: Team notifications, basic review process, change visibility
**Use Case**:
- Multiple team members deploy to production
- Want Slack/email notifications when deployments happen
- Need to review what was deployed by teammates
- Want ability to comment on changes via PR

### Persona 3: Enterprise Organization

**Profile**: Large company with compliance requirements
**Needs**: Audit trail, approval workflows, fine-grained permissions
**Use Case**:
- SOC2/ISO compliance requires documented change management
- Need approval from lead before production deployment
- Want to enforce code review even for prompt changes
- Need integration with existing GitHub org policies (CODEOWNERS, required reviews)

---

## Solution Approaches

### Approach 1: Outbound Webhooks (Simple)

**Concept**: Agenta sends HTTP webhooks to external services when deployments occur.

#### Architecture

```
┌─────────────┐      Deploy     ┌─────────────┐
│   Agenta    │─────────────────>│   Backend   │
│     UI      │                  │     API     │
└─────────────┘                  └──────┬──────┘
                                        │
                                        │ Webhook Event
                                        ▼
                                 ┌─────────────┐
                                 │  Webhook    │
                                 │  Endpoint   │
                                 │  (User's)   │
                                 └──────┬──────┘
                                        │
                                        │ GitHub API
                                        ▼
                                 ┌─────────────┐
                                 │   GitHub    │
                                 │  Create PR  │
                                 └─────────────┘
```

#### How It Works

1. User configures webhook URL in Agenta settings
2. On production deployment, Agenta sends POST request:
   ```json
   {
     "event": "environment.deployed",
     "timestamp": "2025-11-20T10:30:00Z",
     "project_id": "abc123",
     "app_name": "customer-support-bot",
     "variant_name": "v2-optimized",
     "environment": "production",
     "revision": 15,
     "commit_message": "Improved response quality",
     "config_diff": {
       "added": {},
       "modified": {
         "temperature": [0.7, 0.5],
         "system_prompt": ["...", "..."]
       },
       "removed": {}
     },
     "deployed_by": "jane@company.com"
   }
   ```
3. User's webhook service receives event and creates GitHub PR using GitHub API
4. PR contains deployment details and config changes

#### Configuration UI

**Settings Page** (`/settings/integrations`):
```
┌────────────────────────────────────────────────┐
│ Integrations > Webhooks                        │
├────────────────────────────────────────────────┤
│                                                │
│ Deployment Webhooks                            │
│ ─────────────────────────────────────────────  │
│                                                │
│ Send webhook when:                             │
│ ☑ Variant deployed to production               │
│ ☐ Variant deployed to any environment          │
│ ☐ Variant created                              │
│                                                │
│ Webhook URL:                                   │
│ ┌────────────────────────────────────────────┐ │
│ │ https://hooks.company.com/agenta/deploy    │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ Secret (for signature verification):          │
│ ┌────────────────────────────────────────────┐ │
│ │ ••••••••••••••••••••••••••••••             │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ [Test Webhook] [Save]                          │
│                                                │
└────────────────────────────────────────────────┘
```

#### Pros
- ✅ **Simple to implement** (backend only, ~500 LOC)
- ✅ **Flexible** - works with any external service (GitHub, Slack, custom)
- ✅ **No OAuth complexity** - user handles authentication
- ✅ **No compliance concerns** - no GitHub tokens stored in Agenta
- ✅ **Fast MVP** (1-2 weeks implementation)
- ✅ **Testable** - users can test webhooks independently

#### Cons
- ❌ **User must build webhook handler** (not turnkey solution)
- ❌ **No built-in PR creation** - requires user code
- ❌ **Additional infrastructure** needed by user
- ❌ **Not beginner-friendly** - requires dev skills
- ❌ **Maintenance burden** on users

#### Best For
- Technical teams with existing webhook infrastructure
- Organizations wanting custom integration logic
- MVP/early adopters willing to build webhook handlers

---

### Approach 2: GitHub Integration Service (Intermediate)

**Concept**: Agenta provides optional hosted service that creates PRs on user's behalf.

#### Architecture

```
┌─────────────┐      Deploy     ┌─────────────┐
│   Agenta    │─────────────────>│   Backend   │
│     UI      │                  │     API     │
└─────────────┘                  └──────┬──────┘
                                        │
                                        │ Event
                                        ▼
                                 ┌─────────────┐
                                 │   GitHub    │
                                 │ Integration │
                                 │  Service    │
                                 │  (Agenta)   │
                                 └──────┬──────┘
                                        │
                                        │ GitHub API
                                        │ (using PAT)
                                        ▼
                                 ┌─────────────┐
                                 │   GitHub    │
                                 │  Create PR  │
                                 └─────────────┘
```

#### How It Works

1. User generates GitHub Personal Access Token (PAT) with `repo` scope
2. User configures GitHub integration in Agenta settings:
   - Repository URL
   - Base branch
   - PAT (encrypted at rest)
   - PR template
3. On production deployment, Agenta service:
   - Creates branch: `agenta/deploy-{variant}-{timestamp}`
   - Commits file: `deployments/{app_name}/{environment}.json`
   - Creates PR with deployment details
   - Adds labels: `agenta-deployment`, `production`
4. PR is created automatically, team is notified

#### Configuration UI

**Settings Page** (`/settings/integrations/github`):
```
┌────────────────────────────────────────────────┐
│ Integrations > GitHub                          │
├────────────────────────────────────────────────┤
│                                                │
│ GitHub Repository                              │
│ ─────────────────────────────────────────────  │
│                                                │
│ Repository:                                    │
│ ┌────────────────────────────────────────────┐ │
│ │ org/repo                                   │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ Base Branch:                                   │
│ ┌────────────────────────────────────────────┐ │
│ │ main                                       │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ Personal Access Token:                         │
│ ┌────────────────────────────────────────────┐ │
│ │ ghp_••••••••••••••••••••••••••••••         │ │
│ └────────────────────────────────────────────┘ │
│ ℹ️ Required scopes: repo                       │
│                                                │
│ Create PRs for:                                │
│ ☑ Production deployments                       │
│ ☐ Staging deployments                          │
│                                                │
│ PR Settings:                                   │
│ Auto-merge: ☐ Enable                           │
│ Reviewers: [Select users...]                   │
│                                                │
│ [Test Connection] [Save]                       │
│                                                │
└────────────────────────────────────────────────┘
```

#### Generated PR Example

```markdown
# 🤖 Agenta Deployment: customer-support-bot → production

**Environment**: production
**Application**: customer-support-bot
**Variant**: v2-optimized (revision 15)
**Deployed by**: jane@company.com
**Timestamp**: 2025-11-20 10:30:00 UTC

## Changes

### Modified Parameters

- `temperature`: 0.7 → 0.5
- `system_prompt`:
  ```diff
  - You are a helpful customer support assistant
  + You are a helpful customer support assistant. Be concise and professional.
  ```

## Commit Message

> Improved response quality

## Review

View this deployment in Agenta: https://app.agenta.ai/projects/abc/apps/xyz

---

*Automatically generated by Agenta*
```

#### What Gets Committed

**File**: `deployments/{app_name}/production.json`
```json
{
  "app_name": "customer-support-bot",
  "variant_name": "v2-optimized",
  "revision": 15,
  "deployed_at": "2025-11-20T10:30:00Z",
  "deployed_by": "jane@company.com",
  "commit_message": "Improved response quality",
  "config": {
    "temperature": 0.5,
    "model": "gpt-4",
    "system_prompt": "You are a helpful customer support assistant. Be concise and professional.",
    "max_tokens": 500
  }
}
```

#### Pros
- ✅ **Turnkey solution** - works out of the box
- ✅ **User-friendly** - just provide PAT and repo
- ✅ **Familiar UX** - standard GitHub workflow
- ✅ **Built-in features** - PR templates, labels, reviewers
- ✅ **No user infrastructure** needed
- ✅ **Good for small/medium teams**

#### Cons
- ❌ **PAT management** - users must create and rotate tokens
- ❌ **Security concern** - storing user credentials (even encrypted)
- ❌ **Limited permissions** - PAT has broad access
- ❌ **Not enterprise-grade** - no fine-grained permissions
- ❌ **Token expiration** - breaks when PAT expires

#### Best For
- Small to medium teams
- Users wanting turnkey solution
- Non-enterprise deployments

---

### Approach 3: GitHub App (Complex)

**Concept**: Official Agenta GitHub App with OAuth flow and fine-grained permissions.

#### Architecture

```
┌─────────────┐   Install App   ┌─────────────┐
│   GitHub    │<────────────────│   Agenta    │
│ Marketplace │                 │     UI      │
└─────────────┘                 └──────┬──────┘
       │                               │
       │ OAuth Flow                    │
       ▼                               ▼
┌─────────────┐                 ┌─────────────┐
│  GitHub     │   App Token     │   Backend   │
│   OAuth     │─────────────────>│     API     │
└─────────────┘                 └──────┬──────┘
                                       │
                                       │ Event
                                       ▼
                                ┌─────────────┐
                                │   GitHub    │
                                │  App API    │
                                │  (GitHub's) │
                                └──────┬──────┘
                                       │
                                       │ Create PR
                                       ▼
                                ┌─────────────┐
                                │   GitHub    │
                                │  Repository │
                                └─────────────┘
```

#### How It Works

1. **Installation**:
   - Admin visits GitHub Marketplace or Agenta settings
   - Clicks "Install Agenta App"
   - OAuth flow begins
   - Admin selects repositories to grant access
   - GitHub provides installation token to Agenta

2. **Configuration**:
   - Agenta automatically detects installed repositories
   - User maps Agenta projects to GitHub repos
   - User configures deployment rules per environment

3. **Deployment**:
   - On production deployment, Agenta uses GitHub App API
   - Creates branch and PR using app credentials
   - App posts deployment status as PR check
   - Team receives notifications via GitHub

4. **Bidirectional (Optional)**:
   - GitHub App can also listen to PR events (webhook from GitHub)
   - When PR merged, trigger deployment in Agenta
   - Full GitOps workflow

#### Configuration UI

**Settings Page** (`/settings/integrations/github-app`):
```
┌────────────────────────────────────────────────┐
│ Integrations > GitHub App                      │
├────────────────────────────────────────────────┤
│                                                │
│ [Install Agenta GitHub App]                    │
│                                                │
│ ──────────────────────────────────────────────│
│                                                │
│ ✅ Installed on org/repo                       │
│                                                │
│ Repository Mapping                             │
│ ─────────────────────────────────────────────  │
│                                                │
│ Agenta Project → GitHub Repository             │
│ ┌──────────────┬──────────────────┬─────────┐ │
│ │ Project      │ Repository       │ Branch  │ │
│ ├──────────────┼──────────────────┼─────────┤ │
│ │ customer-bot │ org/repo         │ main    │ │
│ │ analytics    │ org/other-repo   │ main    │ │
│ └──────────────┴──────────────────┴─────────┘ │
│                                                │
│ Deployment Rules                               │
│ ─────────────────────────────────────────────  │
│                                                │
│ Production:                                    │
│ ☑ Create PR on deployment                      │
│ ☑ Require approval before merge                │
│ ☐ Auto-merge after approval                    │
│                                                │
│ Staging:                                       │
│ ☑ Create PR on deployment                      │
│ ☑ Auto-merge (no review)                       │
│                                                │
│ Notifications                                  │
│ ─────────────────────────────────────────────  │
│                                                │
│ ☑ Comment deployment status on PR              │
│ ☑ Add deployment label to PR                   │
│ ☐ Request review from CODEOWNERS               │
│                                                │
│ [Save Settings]                                │
│                                                │
└────────────────────────────────────────────────┘
```

#### GitHub App Permissions

**Required Permissions**:
- `contents: write` - Create branches and commits
- `pull_requests: write` - Create and update PRs
- `metadata: read` - Read repository metadata

**Optional Permissions** (for advanced features):
- `checks: write` - Post deployment status checks
- `pull_requests: read` - Listen to PR events (GitOps)
- `issues: write` - Create issues for failed deployments

#### Advanced Features

##### 1. Deployment Status Checks

PR includes GitHub check with deployment info:
```
✅ Agenta Deployment Successful
   Environment: production
   Variant: v2-optimized
   View in Agenta →
```

##### 2. Bidirectional GitOps

**GitHub → Agenta**:
- PR merged → Deploy to staging automatically
- PR labeled `deploy:production` → Deploy to production

**Agenta → GitHub**:
- Production deployment → Create PR
- PR includes deployment details

##### 3. Multi-Environment Workflow

```
PR Created (dev branch)
    ↓
Auto-deploy to dev environment
    ↓
Tests pass → Auto-deploy to staging
    ↓
PR approved & merged
    ↓
Auto-deploy to production
    ↓
PR created documenting production state
```

#### Pros
- ✅ **Enterprise-grade** - fine-grained permissions
- ✅ **Secure** - no user credentials stored
- ✅ **Official integration** - listed in GitHub Marketplace
- ✅ **Token management** handled by GitHub
- ✅ **Bidirectional** - full GitOps support
- ✅ **Best UX** - one-click install
- ✅ **Scalable** - supports orgs with many repos
- ✅ **GitHub features** - checks, statuses, webhooks
- ✅ **No expiration** - app tokens auto-refresh

#### Cons
- ❌ **Complex implementation** - 3-4 weeks
- ❌ **GitHub review process** - app approval takes time
- ❌ **Maintenance overhead** - must maintain app
- ❌ **Not self-hosted friendly** - requires public endpoint
- ❌ **GitHub-only** - doesn't work with GitLab, Bitbucket

#### Best For
- Enterprise customers
- Organizations with compliance requirements
- Teams wanting full GitOps workflow
- SaaS/Cloud deployments of Agenta

---

## MVP Recommendation

### Recommended Approach: **Hybrid Strategy**

Implement in phases to balance complexity and value:

#### Phase 1: Outbound Webhooks (MVP) - 2 weeks
- Implement webhook system in backend
- Provide webhook documentation and example handler
- Support for `environment.deployed` events
- Basic signature verification

**Why this first?**
- Fastest time to value
- Validates product-market fit
- Unblocks technical users immediately
- No compliance/security concerns
- Foundation for later approaches

#### Phase 2: GitHub Integration Service - 4 weeks
- Build GitHub integration using PATs
- UI for configuration
- Auto-create PRs with deployment details
- Support for production + staging

**Why this second?**
- Makes feature accessible to non-technical users
- Provides turnkey experience
- Validates PR format and content
- Sufficient for 80% of users

#### Phase 3: GitHub App (Enterprise) - 8 weeks
- Build official GitHub App
- Submit to GitHub Marketplace
- Support for advanced features (checks, GitOps)
- Enterprise SSO integration

**Why this last?**
- Targets enterprise segment
- Builds on learnings from Phase 1 & 2
- High complexity, lower urgency

### Launch Strategy

**Week 1-2**: Phase 1 MVP
- Ship webhook system
- Provide open-source example webhook handler (Node.js/Python)
- Gather feedback from early adopters

**Week 3-6**: Phase 2 Development
- Build GitHub integration
- Beta test with select customers
- Iterate on PR format

**Week 7+**: Phase 3 Planning
- Collect enterprise requirements
- Design GitHub App architecture
- Begin GitHub Marketplace submission

---

## Technical Architecture

### Database Schema

**New Table: `webhook_configs`**
```sql
CREATE TABLE webhook_configs (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL, -- encrypted
    events JSONB NOT NULL, -- ["environment.deployed", ...]
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);
```

**New Table: `webhook_deliveries`** (for audit/retry)
```sql
CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY,
    webhook_config_id UUID REFERENCES webhook_configs(id),
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    delivered_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**New Table: `github_integrations`** (Phase 2)
```sql
CREATE TABLE github_integrations (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    repository VARCHAR(255) NOT NULL, -- "org/repo"
    base_branch VARCHAR(255) DEFAULT 'main',
    access_token TEXT NOT NULL, -- encrypted
    enabled_environments JSONB, -- ["production", "staging"]
    pr_template TEXT,
    auto_merge BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Backend Implementation

**File Structure**:
```
api/oss/src/
├── routers/
│   ├── webhook_router.py         # New: webhook CRUD
│   └── github_integration_router.py  # Phase 2
├── services/
│   ├── webhook_service.py        # New: webhook delivery
│   ├── github_service.py         # Phase 2: PR creation
│   └── db_manager.py             # Updated: emit events
├── models/
│   ├── db_models.py              # Updated: new tables
│   └── api_models.py             # Updated: new endpoints
└── events/
    ├── event_emitter.py          # New: event system
    └── handlers.py               # New: event handlers
```

**Core Components**:

#### 1. Event Emitter (New)

```python
# api/oss/src/events/event_emitter.py

from typing import Dict, Any, List
from datetime import datetime
import httpx
import hmac
import hashlib

class EventEmitter:
    """Emits events to webhooks and internal handlers"""

    async def emit(
        self,
        event_type: str,
        payload: Dict[str, Any],
        project_id: str
    ):
        """Emit event to all registered webhooks"""
        webhooks = await self._get_webhooks(project_id, event_type)

        for webhook in webhooks:
            await self._deliver_webhook(webhook, event_type, payload)

    async def _deliver_webhook(
        self,
        webhook: WebhookConfig,
        event_type: str,
        payload: Dict[str, Any]
    ):
        """Deliver webhook with retry logic"""
        delivery_payload = {
            "event": event_type,
            "timestamp": datetime.utcnow().isoformat(),
            "data": payload
        }

        # Sign payload
        signature = self._sign_payload(
            delivery_payload,
            webhook.secret
        )

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    webhook.url,
                    json=delivery_payload,
                    headers={
                        "X-Agenta-Event": event_type,
                        "X-Agenta-Signature": signature,
                        "User-Agent": "Agenta-Webhook/1.0"
                    }
                )

                # Log delivery
                await self._log_delivery(
                    webhook.id,
                    event_type,
                    delivery_payload,
                    response.status_code,
                    response.text
                )

        except Exception as e:
            # Log failure and schedule retry
            await self._log_delivery(
                webhook.id,
                event_type,
                delivery_payload,
                None,
                str(e)
            )
            await self._schedule_retry(webhook.id, event_type, payload)

    def _sign_payload(self, payload: Dict, secret: str) -> str:
        """Create HMAC signature"""
        message = json.dumps(payload, sort_keys=True)
        signature = hmac.new(
            secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        return f"sha256={signature}"
```

#### 2. Updated Deployment Service

```python
# api/oss/src/services/db_manager.py

async def deploy_to_environment(
    environment_name: str,
    variant_id: str,
    project_id: str,
    commit_message: Optional[str] = None
) -> DeploymentResponse:
    """Deploy variant to environment"""

    # Existing deployment logic...
    deployment = await _perform_deployment(...)

    # NEW: Emit deployment event
    await event_emitter.emit(
        event_type="environment.deployed",
        payload={
            "project_id": project_id,
            "app_name": variant.app.app_name,
            "variant_name": variant.variant_name,
            "variant_id": str(variant_id),
            "environment": environment_name,
            "revision": revision.revision,
            "commit_message": commit_message,
            "config_diff": _compute_config_diff(prev_revision, revision),
            "deployed_by": user.email,
            "deployment_id": str(deployment.id)
        },
        project_id=project_id
    )

    return deployment
```

#### 3. Webhook Router (New)

```python
# api/oss/src/routers/webhook_router.py

from fastapi import APIRouter, Depends
from typing import List

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

@router.post("/")
async def create_webhook(
    webhook: WebhookCreate,
    project_id: str = Depends(get_project_id)
):
    """Create webhook configuration"""
    # Validate URL
    # Encrypt secret
    # Store in database
    pass

@router.get("/")
async def list_webhooks(
    project_id: str = Depends(get_project_id)
) -> List[WebhookConfig]:
    """List webhooks for project"""
    pass

@router.post("/{webhook_id}/test")
async def test_webhook(
    webhook_id: str,
    project_id: str = Depends(get_project_id)
):
    """Send test event to webhook"""
    pass

@router.get("/{webhook_id}/deliveries")
async def list_deliveries(
    webhook_id: str,
    project_id: str = Depends(get_project_id)
) -> List[WebhookDelivery]:
    """List webhook delivery history"""
    pass
```

### Frontend Implementation

**File Structure**:
```
web/oss/src/
├── components/
│   └── Settings/
│       └── Integrations/
│           ├── WebhookSettings.tsx      # New
│           └── GitHubSettings.tsx       # Phase 2
├── services/
│   └── webhook/
│       └── api.ts                       # New
└── state/
    └── webhooks/
        └── atoms.ts                     # New
```

**Webhook Settings Component**:

```typescript
// web/oss/src/components/Settings/Integrations/WebhookSettings.tsx

export const WebhookSettings = () => {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div>
      <h2>Webhooks</h2>
      <p>Send events to external services when deployments occur.</p>

      <Button onClick={() => setIsCreating(true)}>
        Add Webhook
      </Button>

      <WebhookList webhooks={webhooks} />

      {isCreating && (
        <WebhookCreateModal
          onClose={() => setIsCreating(false)}
          onCreated={(webhook) => {
            setWebhooks([...webhooks, webhook]);
            setIsCreating(false);
          }}
        />
      )}
    </div>
  );
};

const WebhookCreateModal = ({ onClose, onCreated }) => {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(['environment.deployed']);
  const [secret, setSecret] = useState(generateSecret());

  const handleCreate = async () => {
    const webhook = await createWebhook({
      url,
      events,
      secret,
    });
    onCreated(webhook);
  };

  return (
    <Modal>
      <h3>Create Webhook</h3>

      <FormField label="Webhook URL">
        <Input
          value={url}
          onChange={setUrl}
          placeholder="https://hooks.company.com/agenta"
        />
      </FormField>

      <FormField label="Events">
        <Checkbox
          checked={events.includes('environment.deployed')}
          label="Deployed to production"
        />
        <Checkbox
          checked={events.includes('environment.deployed.staging')}
          label="Deployed to staging"
        />
      </FormField>

      <FormField label="Secret">
        <Input value={secret} readOnly />
        <Button onClick={() => setSecret(generateSecret())}>
          Regenerate
        </Button>
      </FormField>

      <Button onClick={handleTest}>Test Webhook</Button>
      <Button onClick={handleCreate}>Create</Button>
    </Modal>
  );
};
```

### Example Webhook Handler

**Provide reference implementation for users**:

```typescript
// examples/webhook-handlers/github-pr-creator.ts

import { Octokit } from '@octokit/rest';
import { verify } from 'crypto';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

export async function handleAgentaWebhook(req, res) {
  // Verify signature
  const signature = req.headers['x-agenta-signature'];
  if (!verifySignature(req.body, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event, data } = req.body;

  if (event === 'environment.deployed' && data.environment === 'production') {
    await createDeploymentPR(data);
  }

  res.json({ received: true });
}

async function createDeploymentPR(deployment) {
  const { app_name, variant_name, config_diff, deployed_by } = deployment;

  // Create branch
  const branchName = `agenta/deploy-${Date.now()}`;
  await octokit.git.createRef({
    owner: 'your-org',
    repo: 'your-repo',
    ref: `refs/heads/${branchName}`,
    sha: await getMainBranchSha()
  });

  // Create/update deployment file
  const deploymentFile = `deployments/${app_name}/production.json`;
  await octokit.repos.createOrUpdateFileContents({
    owner: 'your-org',
    repo: 'your-repo',
    path: deploymentFile,
    message: `Deploy ${variant_name} to production`,
    content: Buffer.from(JSON.stringify(deployment.config, null, 2)).toString('base64'),
    branch: branchName
  });

  // Create PR
  const pr = await octokit.pulls.create({
    owner: 'your-org',
    repo: 'your-repo',
    title: `🤖 Deploy ${app_name} to production`,
    head: branchName,
    base: 'main',
    body: formatPRBody(deployment)
  });

  // Add labels
  await octokit.issues.addLabels({
    owner: 'your-org',
    repo: 'your-repo',
    issue_number: pr.data.number,
    labels: ['agenta-deployment', 'production']
  });

  console.log(`Created PR: ${pr.data.html_url}`);
}

function formatPRBody(deployment) {
  return `
# 🤖 Agenta Deployment

**Environment**: ${deployment.environment}
**Application**: ${deployment.app_name}
**Variant**: ${deployment.variant_name} (revision ${deployment.revision})
**Deployed by**: ${deployment.deployed_by}

## Changes

${formatConfigDiff(deployment.config_diff)}

## Commit Message

> ${deployment.commit_message}

---
*Automatically generated by Agenta*
  `.trim();
}
```

---

## Configuration & User Experience

### Setup Flow: Webhook Approach

**Step 1: Enable Webhooks**
```
Settings > Integrations > Webhooks > Add Webhook
```

**Step 2: Configure Webhook**
- Enter webhook URL (user's endpoint)
- Select events (production deployments)
- Generate/enter secret
- Test webhook

**Step 3: Deploy Webhook Handler**
- User deploys webhook handler to their infrastructure
- Handler creates PRs using GitHub API

**Step 4: Deploy in Agenta**
- User deploys normally
- Webhook fired automatically
- PR created by handler

### Setup Flow: GitHub Integration Approach

**Step 1: Connect GitHub**
```
Settings > Integrations > GitHub > Connect
```

**Step 2: Provide Credentials**
- Enter repository (org/repo)
- Provide Personal Access Token
- Select base branch

**Step 3: Configure Rules**
- Select which environments trigger PRs
- Set auto-merge preferences
- Configure reviewers

**Step 4: Deploy in Agenta**
- User deploys normally
- PR created automatically by Agenta

### Setup Flow: GitHub App Approach

**Step 1: Install App**
```
Settings > Integrations > GitHub App > Install
```

**Step 2: OAuth Flow**
- Redirect to GitHub
- Select repositories to grant access
- Approve permissions
- Return to Agenta

**Step 3: Map Projects**
- Map Agenta projects to GitHub repos
- Configure deployment rules per environment

**Step 4: Deploy in Agenta**
- User deploys normally
- PR created automatically
- Status checks posted to PR

### User Communication

**Deployment Modal Enhancement**:

```
┌────────────────────────────────────────────────┐
│ Deploy to Production                           │
├────────────────────────────────────────────────┤
│                                                │
│ Variant: v2-optimized                          │
│ Environment: production                        │
│                                                │
│ Commit Message:                                │
│ ┌────────────────────────────────────────────┐ │
│ │ Improved response quality                  │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ ✅ GitHub PR will be created automatically     │
│    Repository: org/repo                        │
│                                                │
│ [Cancel] [Deploy]                              │
│                                                │
└────────────────────────────────────────────────┘
```

**Post-Deployment Notification**:

```
┌────────────────────────────────────────────────┐
│ ✅ Deployed Successfully                        │
├────────────────────────────────────────────────┤
│                                                │
│ v2-optimized has been deployed to production   │
│                                                │
│ 📝 GitHub PR created: #123                     │
│    View PR: https://github.com/org/repo/pull/123│
│                                                │
│ [View Deployment] [View PR]                    │
│                                                │
└────────────────────────────────────────────────┘
```

---

## Compliance & Security

### Security Considerations

#### 1. Webhook Security

**Threats**:
- Webhook URL spoofing
- Replay attacks
- Man-in-the-middle

**Mitigations**:
- ✅ HMAC signature verification (using shared secret)
- ✅ HTTPS required for webhook URLs
- ✅ Timestamp validation (reject old events)
- ✅ Secrets encrypted at rest (AES-256)
- ✅ Rate limiting on webhook endpoints
- ✅ IP allowlisting (optional)

**Implementation**:
```python
def verify_webhook_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

#### 2. GitHub Token Security

**Threats**:
- Token leakage
- Excessive permissions
- Token expiration handling

**Mitigations**:
- ✅ Tokens encrypted at rest (AES-256)
- ✅ Tokens never logged or exposed in API responses
- ✅ Minimum required scopes documented
- ✅ Regular token rotation reminder
- ✅ Token validation on configuration
- ✅ Audit log of token usage

**For GitHub App**:
- ✅ App tokens expire automatically (1 hour)
- ✅ Fine-grained permissions (not full repo access)
- ✅ Installation-level access (not user-level)
- ✅ GitHub manages token lifecycle

#### 3. Data Privacy

**Concerns**:
- Prompt content may contain sensitive data
- Config parameters may include API keys

**Mitigations**:
- ✅ Option to exclude sensitive fields from PR
- ✅ Redaction of secrets in diffs (e.g., `api_key: [REDACTED]`)
- ✅ Private repository enforcement
- ✅ User controls what data is included

**Configuration**:
```yaml
# User can configure what to include in PR
pr_settings:
  include_config_diff: true
  redact_secrets: true  # Redact fields matching patterns
  secret_patterns:
    - "*_key"
    - "*_token"
    - "password"
```

### Compliance Features

#### SOC2 / ISO 27001

**Requirements**:
- Audit trail of all changes
- Change management process
- Access control
- Data encryption

**How PR Automation Helps**:
- ✅ **Audit Trail**: Every deployment documented in GitHub
- ✅ **Change Management**: PRs provide review/approval process
- ✅ **Access Control**: GitHub's RBAC controls who can deploy
- ✅ **Traceability**: Link deployments to code changes

#### GDPR

**Requirements**:
- Data minimization
- Right to be forgotten
- Data portability

**Considerations**:
- ✅ Only essential data included in PRs
- ✅ User email (PII) can be pseudonymized
- ✅ Webhook data can be exported/deleted

#### Industry-Specific (Healthcare, Finance)

**Requirements**:
- 4-eyes principle (dual approval)
- Immutable audit logs
- Segregation of duties

**Support**:
- ✅ GitHub required reviews (2+ approvers)
- ✅ Branch protection rules
- ✅ CODEOWNERS for automatic reviewer assignment
- ✅ Audit log preserved in Git history

### Enterprise Features (Future)

- **SSO Integration**: SAML/OAuth with GitHub Enterprise
- **Custom Approval Workflows**: Integration with ServiceNow, Jira
- **Policy as Code**: Enforce deployment policies (e.g., must include evaluation results)
- **Rollback Protection**: Require justification for rollbacks

---

## Implementation Phases

### Phase 1: Webhook MVP (2 weeks)

**Sprint 1 (Week 1)**:
- [ ] Design database schema (webhook_configs, webhook_deliveries)
- [ ] Implement event emitter system
- [ ] Add webhook CRUD API endpoints
- [ ] Implement signature generation/verification
- [ ] Update deployment service to emit events
- [ ] Write unit tests

**Sprint 2 (Week 2)**:
- [ ] Build webhook settings UI
- [ ] Implement webhook testing feature
- [ ] Add delivery history/retry logic
- [ ] Create documentation
- [ ] Write example webhook handler (Node.js + Python)
- [ ] Beta test with 3-5 users

**Deliverables**:
- ✅ Webhook API (POST, GET, DELETE, TEST)
- ✅ Event emission on production deployments
- ✅ Settings UI for webhook configuration
- ✅ Documentation + example handlers
- ✅ GitHub reference implementation

### Phase 2: GitHub Integration (4 weeks)

**Sprint 3 (Week 3)**:
- [ ] Design GitHub integration schema
- [ ] Implement GitHub API client (using PAT)
- [ ] Build PR creation service
- [ ] Implement config diff computation
- [ ] Write unit tests

**Sprint 4 (Week 4)**:
- [ ] Build GitHub settings UI
- [ ] Implement repository validation
- [ ] Add PR template customization
- [ ] Test connection feature
- [ ] Integration tests

**Sprint 5 (Week 5)**:
- [ ] Build deployment notification system
- [ ] Add PR link to deployment history
- [ ] Implement auto-merge option
- [ ] Add reviewer assignment
- [ ] Error handling and retry

**Sprint 6 (Week 6)**:
- [ ] End-to-end testing
- [ ] Documentation
- [ ] Beta program (10-15 users)
- [ ] Gather feedback and iterate

**Deliverables**:
- ✅ GitHub integration with PAT
- ✅ Auto-create PRs on production deployment
- ✅ Configurable PR templates
- ✅ Settings UI for GitHub configuration
- ✅ Comprehensive documentation

### Phase 3: GitHub App (8 weeks)

**Planning (Week 7-8)**:
- [ ] Define GitHub App permissions
- [ ] Design OAuth flow
- [ ] Design installation/configuration UX
- [ ] Create GitHub App in GitHub settings
- [ ] Set up webhook endpoints for GitHub

**Development (Week 9-12)**:
- [ ] Implement GitHub App OAuth flow
- [ ] Build installation webhook handler
- [ ] Implement app token management (auto-refresh)
- [ ] Build repository mapping system
- [ ] Implement PR creation via GitHub App API
- [ ] Add deployment status checks
- [ ] Comprehensive testing

**Advanced Features (Week 13-14)**:
- [ ] Bidirectional sync (PR events → Agenta)
- [ ] GitOps workflow (merge → auto-deploy)
- [ ] Multi-environment orchestration
- [ ] Integration with GitHub checks API

**Launch (Week 15)**:
- [ ] Submit app to GitHub Marketplace
- [ ] Complete security review
- [ ] Marketing materials
- [ ] Launch to general availability

**Deliverables**:
- ✅ Official Agenta GitHub App
- ✅ Listed in GitHub Marketplace
- ✅ One-click installation
- ✅ Advanced features (checks, GitOps)
- ✅ Enterprise-ready

---

## Open Questions

### Product Questions

1. **Directionality**: Should this be one-way (Agenta → GitHub) or bidirectional (GitOps)?
   - **Recommendation**: Start one-way, add bidirectional in Phase 3

2. **Merge Behavior**: Should PRs auto-merge or require manual approval?
   - **Recommendation**: Configurable per environment (auto for staging, manual for prod)

3. **PR Target**: Create PR against main branch or dedicated deployment branch?
   - **Recommendation**: Configurable, default to main

4. **Multiple Deployments**: How to handle rapid successive deployments?
   - **Recommendation**: Each deployment = separate PR (or update existing open PR)

5. **Failed Deployments**: Should failed deployments create PRs?
   - **Recommendation**: No, only successful deployments

6. **Historical Deployments**: What about deployments before integration enabled?
   - **Recommendation**: Only track future deployments

### Technical Questions

1. **Webhook Reliability**: How to handle webhook failures?
   - **Recommendation**: Retry 3 times with exponential backoff, then alert user

2. **Token Rotation**: How to remind users to rotate tokens?
   - **Recommendation**: Check token age, show warning after 90 days

3. **Rate Limiting**: How to handle GitHub API rate limits?
   - **Recommendation**: Queue PR creation jobs, respect rate limits

4. **Large Configs**: What if config diff is huge (>1MB)?
   - **Recommendation**: Truncate diff in PR, link to full config in Agenta

5. **Multi-Repo**: Can one Agenta project map to multiple GitHub repos?
   - **Recommendation**: Phase 3 feature, not MVP

6. **Self-Hosted**: How does this work for self-hosted Agenta?
   - **Recommendation**: Webhooks work anywhere, GitHub App requires public endpoint

### Security Questions

1. **Token Storage**: Where to store GitHub tokens?
   - **Recommendation**: Encrypted in PostgreSQL, consider HashiCorp Vault for enterprise

2. **Audit Logs**: Should we log webhook/PR activity?
   - **Recommendation**: Yes, log all integration activity with retention policy

3. **Access Control**: Who can configure integrations?
   - **Recommendation**: Project admins only (add permission check)

4. **Secret Rotation**: How often to rotate webhook secrets?
   - **Recommendation**: On-demand, recommend every 90 days

---

## Success Metrics

### Adoption Metrics
- % of projects with GitHub integration enabled
- Number of PRs created per week
- Active webhook configurations

### Engagement Metrics
- PR review time (from creation to merge)
- PR review participation rate
- Comments on auto-generated PRs

### Quality Metrics
- Webhook delivery success rate (target: >99%)
- PR creation success rate (target: >95%)
- Time from deployment to PR creation (target: <30s)

### Business Metrics
- Enterprise tier adoption increase
- Customer retention improvement
- Support ticket reduction (deployment-related)

---

## Competitive Analysis

### Existing Solutions

**GitOps Tools** (ArgoCD, Flux):
- Focus: Code/infra → K8s deployment
- Direction: Git → Deployment (one-way)
- Limitation: Don't support prompt versioning

**Vercel/Netlify**:
- Focus: Git commits → Preview/production deployment
- Direction: Git → Deployment (one-way)
- Limitation: Code-focused, not config-focused

**MLflow/W&B**:
- Focus: Model versioning and tracking
- Integration: Limited GitHub integration
- Limitation: No automatic PR creation

### Agenta's Differentiation

✅ **Config-First**: Optimized for prompt/config versioning, not code
✅ **Bidirectional**: Support both Agenta → GitHub and GitHub → Agenta
✅ **Audit-Focused**: Compliance-oriented documentation
✅ **LLM-Native**: Understands prompt diffs, evaluation results
✅ **Flexible**: Webhooks support any integration, not just GitHub

---

## Conclusion

### Recommendation Summary

**MVP Path**: Webhook System (Phase 1)
- **Timeline**: 2 weeks
- **Effort**: Low
- **Value**: High (unblocks technical users)
- **Risk**: Low

**Short-Term**: GitHub Integration (Phase 2)
- **Timeline**: 4 weeks
- **Effort**: Medium
- **Value**: Very High (mainstream adoption)
- **Risk**: Low-Medium (token management)

**Long-Term**: GitHub App (Phase 3)
- **Timeline**: 8 weeks
- **Effort**: High
- **Value**: High (enterprise segment)
- **Risk**: Medium (complexity, review process)

### Next Steps

1. **Validate with customers**: Interview 5-10 target users
   - Would you use this feature?
   - Which approach do you prefer?
   - What compliance requirements do you have?

2. **Prototype Phase 1**: Build webhook MVP in 2 weeks
   - Get working in staging environment
   - Test with beta users
   - Gather feedback

3. **Decision point**: After Phase 1, decide on Phase 2 vs Phase 3
   - If demand is primarily SMB → Phase 2
   - If demand is primarily Enterprise → Phase 3
   - If mixed → Phase 2 first, then Phase 3

4. **Document and communicate**: Share this design with team
   - Engineering review (technical feasibility)
   - Product review (user value)
   - Security review (compliance)

---

## Appendices

### Appendix A: Webhook Event Schema

```json
{
  "event": "environment.deployed",
  "timestamp": "2025-11-20T10:30:00Z",
  "delivery_id": "uuid",
  "project_id": "abc123",
  "data": {
    "app_id": "uuid",
    "app_name": "customer-support-bot",
    "variant_id": "uuid",
    "variant_name": "v2-optimized",
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
          "old": "You are a helpful customer support assistant",
          "new": "You are a helpful customer support assistant. Be concise and professional."
        }
      },
      "removed": {}
    },
    "deployed_by": {
      "user_id": "uuid",
      "email": "jane@company.com",
      "name": "Jane Doe"
    },
    "deployment_id": "uuid",
    "previous_revision": 14
  }
}
```

### Appendix B: GitHub App Manifest

```json
{
  "name": "Agenta",
  "url": "https://agenta.ai",
  "hook_attributes": {
    "url": "https://api.agenta.ai/webhooks/github"
  },
  "redirect_url": "https://app.agenta.ai/settings/integrations/github/callback",
  "public": true,
  "default_permissions": {
    "contents": "write",
    "pull_requests": "write",
    "metadata": "read",
    "checks": "write"
  },
  "default_events": [
    "pull_request",
    "push"
  ]
}
```

### Appendix C: Example Deployment File

```json
{
  "app_name": "customer-support-bot",
  "environment": "production",
  "deployed_at": "2025-11-20T10:30:00Z",
  "deployed_by": "jane@company.com",
  "variant": {
    "name": "v2-optimized",
    "revision": 15
  },
  "config": {
    "model": "gpt-4",
    "temperature": 0.5,
    "max_tokens": 500,
    "system_prompt": "You are a helpful customer support assistant. Be concise and professional.",
    "tools": [],
    "response_format": "text"
  },
  "metadata": {
    "agenta_url": "https://app.agenta.ai/projects/abc/apps/xyz",
    "deployment_id": "uuid",
    "commit_message": "Improved response quality"
  }
}
```

### Appendix D: Cost Estimate

**Phase 1 (Webhook MVP)**:
- Backend: 40 hours (1 senior engineer)
- Frontend: 24 hours (1 frontend engineer)
- Testing: 16 hours
- **Total**: 80 hours (~2 weeks)

**Phase 2 (GitHub Integration)**:
- Backend: 80 hours (1 senior engineer)
- Frontend: 40 hours (1 frontend engineer)
- Testing: 40 hours
- **Total**: 160 hours (~4 weeks)

**Phase 3 (GitHub App)**:
- Backend: 160 hours (1 senior engineer)
- Frontend: 80 hours (1 frontend engineer)
- DevOps: 40 hours (GitHub App setup)
- Testing: 40 hours
- **Total**: 320 hours (~8 weeks)

**Infrastructure Costs**:
- Webhook delivery: Minimal (<$50/month for 100K events)
- GitHub API calls: Free (5000 req/hour per token)
- GitHub App: Free (marketplace listing)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-20 | Claude | Initial design document |

---

**Feedback**: Please provide feedback on this design via GitHub issues or team discussion.