"""The configuration a new agent starts from, built on the server for ``create_agent``.

The web "New agent" path (``createEphemeralAppFromTemplate`` in
``web/packages/agenta-entities/src/workflow/state/appUtils.ts``) reads the catalog template with
key ``agent`` from ``GET /workflows/catalog/templates/``. This builder reads the same template
through the same function the endpoint serves, so an agent another agent creates starts where a
person's would.

Two steps differ from the browser, because a tool call has no person to ask. The person's
last-used or connected model replaces the template's there; here the template's model stays, and
the creating agent can set ``llm`` in the same call. A template sandbox the deployment does not
enable is replaced: the browser takes the first enabled provider (``ensureEnabledSandbox``), and
this takes the deployment's default provider, the one a run without a sandbox kind gets.
"""

import re
from typing import Any, Dict

from oss.src.resources.workflows.catalog import get_workflow_catalog_template
from oss.src.utils.env import env

NEW_AGENT_TEMPLATE_KEY = "agent"


def new_agent_revision_data() -> Dict[str, Any]:
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
    sandbox = agent.get("sandbox") if isinstance(agent.get("sandbox"), dict) else {}
    # An unset kind runs as `local`.
    kind = sandbox.get("kind") if isinstance(sandbox.get("kind"), str) else "local"
    if kind not in env.runner.enabled_sandbox_providers:
        agent = {
            **agent,
            "sandbox": {**sandbox, "kind": env.runner.default_sandbox_provider},
        }
    parameters["agent"] = agent
    return {
        "uri": data.get("uri"),
        "parameters": parameters,
        "schemas": data.get("schemas"),
    }


def new_agent_slug(name: str) -> str:
    """The web's slug rule (`generateSlug`). The create adds a suffix from the agent's id, so
    two agents may share a name."""
    slug = re.sub(r"[^a-z0-9_.\-\s]", "", name.lower().strip())
    slug = re.sub(r"-+", "-", re.sub(r"\s+", "-", slug)).strip("-.")
    return slug or "agent"
