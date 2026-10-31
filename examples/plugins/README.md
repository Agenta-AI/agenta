# Linear triage plugin

This example packages JavaScript tools and an HTML page as one plugin. People use its page under Plugins. Agents call the same operations through the built-in plugin MCP gateway.

The proof of concept requires the Daytona code runner. It does not add a plugin editor or installer.

## Seed

Create a custom Linear MCP connection and an agent in the same project. Set `LINEAR_MCP_SLUG` to the connection slug shown in Settings if it is not `linear`. Configure the agent's model connection normally. The Linear server must expose `list_issues`, `get_issue`, and `save_issue`.

Set `AGENTA_API_URL`, `AGENTA_API_KEY`, `PROJECT_ID`, and `AGENT_ID` in your environment, then run:

```sh
uv run examples/plugins/seed.py
```

The script checks access to the declared server before creating the plugin. Running it again updates the same plugin and keeps the agent's other settings. New agent links allow reads and ask for approval before `bulk_label`.

Open Plugins → Linear triage. Load your issues, select up to five, and add the Urgent label. Existing labels are preserved. In chat, ask the linked agent to list your open issues or label selected issues.

A failed or timed-out write may have completed. The demo stops on the first uncertain result and does not retry. Check Linear before trying again. Agent calls have a shorter deadline than the sandbox, so use small batches.

## Checks

```sh
node --test examples/plugins/linear-triage/triage.test.cjs
```

The tests check scoring, label preservation, batch limits, and partial completion without retries. Real-server verification also needs the creator's Linear connection; a mock test does not establish that the real tool schemas match.
