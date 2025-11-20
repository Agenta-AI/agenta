"""
POC: Example Webhook Handler - GitHub PR Creator

This is what a USER would deploy to receive webhooks from Agenta
and automatically create GitHub PRs for production deployments.

This demonstrates the "simple solution" approach where users build
their own webhook handlers.
"""

import hmac
import hashlib
import json
import os
from datetime import datetime
from typing import Dict, Any
from flask import Flask, request, jsonify


# Configuration (would be environment variables)
WEBHOOK_SECRET = os.getenv("AGENTA_WEBHOOK_SECRET", "my_webhook_secret_key")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "ghp_your_token_here")
GITHUB_REPO = os.getenv("GITHUB_REPO", "your-org/your-repo")
GITHUB_BASE_BRANCH = os.getenv("GITHUB_BASE_BRANCH", "main")


app = Flask(__name__)


# ============================================================================
# Webhook Handler
# ============================================================================

@app.route("/webhook", methods=["POST"])
def handle_agenta_webhook():
    """
    Receive webhook from Agenta and create GitHub PR.

    This endpoint:
    1. Verifies the webhook signature
    2. Processes the deployment event
    3. Creates a GitHub PR with deployment details
    """
    # Verify signature
    signature = request.headers.get("X-Agenta-Signature", "")
    if not verify_signature(request.data, signature):
        return jsonify({"error": "Invalid signature"}), 401

    # Parse event
    event_data = request.json
    event_type = event_data.get("event")

    print(f"\n📨 Received event: {event_type}")
    print(f"   Timestamp: {event_data.get('timestamp')}")
    print(f"   Delivery ID: {event_data.get('delivery_id')}")

    # Handle deployment event
    if event_type == "environment.deployed":
        deployment = event_data.get("data", {})

        # Only create PR for production deployments
        if deployment.get("environment") == "production":
            print(f"\n🎯 Production deployment detected!")
            print(f"   App: {deployment.get('app_name')}")
            print(f"   Variant: {deployment.get('variant_name')}")

            # Create GitHub PR
            result = create_github_pr(deployment)

            if result["success"]:
                print(f"\n✅ GitHub PR created: {result['pr_url']}")
                return jsonify({
                    "received": True,
                    "pr_created": True,
                    "pr_url": result["pr_url"]
                }), 200
            else:
                print(f"\n❌ Failed to create PR: {result['error']}")
                return jsonify({
                    "received": True,
                    "pr_created": False,
                    "error": result["error"]
                }), 200  # Still return 200 to ack receipt

    return jsonify({"received": True}), 200


def verify_signature(payload: bytes, signature: str) -> bool:
    """
    Verify HMAC signature to ensure webhook came from Agenta.

    This prevents unauthorized webhook deliveries.
    """
    if not signature.startswith("sha256="):
        return False

    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()

    provided = signature[7:]  # Remove "sha256=" prefix

    return hmac.compare_digest(expected, provided)


# ============================================================================
# GitHub PR Creation
# ============================================================================

def create_github_pr(deployment: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create GitHub PR documenting the deployment.

    In a real implementation, this would:
    1. Use GitHub API to create branch
    2. Commit deployment file
    3. Create pull request
    4. Add labels and reviewers

    For this POC, we just simulate the process.
    """
    app_name = deployment.get("app_name")
    variant_name = deployment.get("variant_name")
    revision = deployment.get("revision")

    # In real implementation, use PyGithub or direct API calls
    # For POC, we'll just show what would be done

    print(f"\n📝 Creating GitHub PR...")
    print(f"   Repository: {GITHUB_REPO}")
    print(f"   Base branch: {GITHUB_BASE_BRANCH}")

    # Step 1: Create branch
    branch_name = f"agenta/deploy-{app_name}-{int(datetime.utcnow().timestamp())}"
    print(f"   Creating branch: {branch_name}")

    # Step 2: Create deployment file
    deployment_file_path = f"deployments/{app_name}/production.json"
    deployment_file_content = format_deployment_file(deployment)
    print(f"   Creating file: {deployment_file_path}")

    # Step 3: Create PR
    pr_title = f"🤖 Deploy {app_name} to production"
    pr_body = format_pr_body(deployment)

    print(f"\n📄 PR Title: {pr_title}")
    print(f"📄 PR Body:\n{pr_body}")

    # Simulate successful PR creation
    # In real implementation:
    # - Use GitHub API to create branch, commit, and PR
    # - Handle errors (conflicts, API limits, etc.)
    # - Add labels, reviewers, etc.

    simulated_pr_url = f"https://github.com/{GITHUB_REPO}/pull/123"

    return {
        "success": True,
        "pr_url": simulated_pr_url,
        "pr_number": 123,
        "branch": branch_name
    }


def format_deployment_file(deployment: Dict[str, Any]) -> str:
    """
    Format deployment data as JSON file to commit to repo.

    This file serves as the source of truth for what's deployed.
    """
    deployment_record = {
        "app_name": deployment.get("app_name"),
        "environment": deployment.get("environment"),
        "variant": {
            "name": deployment.get("variant_name"),
            "id": deployment.get("variant_id"),
            "revision": deployment.get("revision")
        },
        "deployed_at": datetime.utcnow().isoformat() + "Z",
        "deployed_by": deployment.get("deployed_by"),
        "commit_message": deployment.get("commit_message"),
        "config_diff": deployment.get("config_diff"),
        "deployment_id": deployment.get("deployment_id")
    }

    return json.dumps(deployment_record, indent=2)


def format_pr_body(deployment: Dict[str, Any]) -> str:
    """
    Format PR description with deployment details.

    This provides a human-readable summary of what was deployed.
    """
    app_name = deployment.get("app_name")
    variant_name = deployment.get("variant_name")
    revision = deployment.get("revision")
    deployed_by = deployment.get("deployed_by")
    commit_message = deployment.get("commit_message", "No commit message")
    config_diff = deployment.get("config_diff", {})

    # Format config changes
    changes_text = format_config_diff(config_diff)

    pr_body = f"""# 🤖 Agenta Deployment: {app_name} → production

**Environment**: production
**Application**: {app_name}
**Variant**: {variant_name} (revision {revision})
**Deployed by**: {deployed_by}
**Timestamp**: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC

## Changes

{changes_text}

## Commit Message

> {commit_message}

## Review Checklist

- [ ] Config changes reviewed
- [ ] Deployment tested in staging
- [ ] Rollback plan documented

---

*Automatically generated by Agenta via webhook*
"""

    return pr_body


def format_config_diff(config_diff: Dict[str, Any]) -> str:
    """Format config diff as markdown"""
    lines = []

    modified = config_diff.get("modified", {})
    if modified:
        lines.append("### Modified Parameters\n")
        for key, value in modified.items():
            old_val = value.get("old")
            new_val = value.get("new")

            # Truncate long values
            if isinstance(old_val, str) and len(old_val) > 100:
                old_val = old_val[:100] + "..."
            if isinstance(new_val, str) and len(new_val) > 100:
                new_val = new_val[:100] + "..."

            lines.append(f"- **{key}**: `{old_val}` → `{new_val}`")

    added = config_diff.get("added", {})
    if added:
        lines.append("\n### Added Parameters\n")
        for key, value in added.items():
            lines.append(f"- **{key}**: `{value}`")

    removed = config_diff.get("removed", {})
    if removed:
        lines.append("\n### Removed Parameters\n")
        for key in removed.keys():
            lines.append(f"- **{key}**")

    if not lines:
        lines.append("*No configuration changes detected*")

    return "\n".join(lines)


# ============================================================================
# Test Endpoint
# ============================================================================

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "Agenta Webhook Handler",
        "github_configured": bool(GITHUB_TOKEN != "ghp_your_token_here")
    })


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    print("=" * 70)
    print("Agenta Webhook Handler - GitHub PR Creator")
    print("=" * 70)
    print(f"Listening for webhooks at: http://localhost:3000/webhook")
    print(f"GitHub repo: {GITHUB_REPO}")
    print(f"Base branch: {GITHUB_BASE_BRANCH}")
    print()
    print("⚠️  Remember to set these environment variables:")
    print("   AGENTA_WEBHOOK_SECRET - Must match secret in Agenta")
    print("   GITHUB_TOKEN - Personal access token with 'repo' scope")
    print("   GITHUB_REPO - Format: 'owner/repo'")
    print("=" * 70)
    print()

    app.run(host="0.0.0.0", port=3000, debug=True)
