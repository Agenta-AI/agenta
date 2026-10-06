"""The configuration a new agent starts from, built on the server for ``create_agent``.

The web "New agent" path (``createEphemeralAppFromTemplate`` in
``web/packages/agenta-entities/src/workflow/state/appUtils.ts``) reads the catalog template with
key ``agent`` from ``GET /workflows/catalog/templates/`` and seeds a sandbox the deployment
enables (``ensureEnabledSandbox`` in ``agentCreationPrefs.ts``). This builder reads the same
template through the same function the endpoint serves, and applies the same sandbox rule, so an
agent another agent creates starts where a person's would.

One step stays in the browser: there the person's last-used or connected model replaces the
template's. A tool call has no person to ask, so the template's model stays, and the creating
agent can set ``llm`` in the same call.
"""

import re
from typing import Any, Dict, Optional, Sequence
from uuid import uuid4

from oss.src.resources.workflows.catalog import get_workflow_catalog_template
from oss.src.utils.env import env

NEW_AGENT_TEMPLATE_KEY = "agent"


def ensure_enabled_sandbox(
    agent: Dict[str, Any],
    enabled_providers: Sequence[str],
) -> Dict[str, Any]:
    """The web's ``ensureEnabledSandbox``: keep a sandbox the deployment enables, else take the
    first one it does. An unset kind runs as ``local``."""
    if not enabled_providers:
        return agent
    sandbox = agent.get("sandbox") if isinstance(agent.get("sandbox"), dict) else {}
    kind = sandbox.get("kind") if isinstance(sandbox.get("kind"), str) else "local"
    if kind in enabled_providers:
        return agent
    return {**agent, "sandbox": {**sandbox, "kind": enabled_providers[0]}}


def new_agent_revision_data(
    *,
    enabled_sandbox_providers: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """``{uri, parameters, schemas}`` for a new agent's first revision."""
    template = get_workflow_catalog_template(
        template_key=NEW_AGENT_TEMPLATE_KEY,
        is_application=True,
    )
    if template is None or template.data is None:
        raise LookupError("The catalog has no agent template.")

    data = template.data.model_dump(mode="json", exclude_none=True)
    parameters = dict(data.get("parameters") or {})
    agent = parameters.get("agent") if isinstance(parameters.get("agent"), dict) else {}
    parameters["agent"] = ensure_enabled_sandbox(
        agent,
        env.runner.enabled_sandbox_providers
        if enabled_sandbox_providers is None
        else enabled_sandbox_providers,
    )
    return {
        "uri": data.get("uri"),
        "parameters": parameters,
        "schemas": data.get("schemas"),
    }


def new_agent_slug(name: str) -> str:
    """The web's slug rule (`generateSlug`) plus a suffix, so two agents may share a name."""
    slug = re.sub(r"[^a-z0-9_.\-\s]", "", name.lower().strip())
    slug = re.sub(r"-+", "-", re.sub(r"\s+", "-", slug)).strip("-.")
    return f"{slug or 'agent'}-{uuid4().hex[:6]}"
