# Build-kit overlay

The build-kit overlay is the read-only agent-template the backend attaches to a fetched
application so the playground can hand a new agent the tools and authoring skill it needs to build
itself. It rides the simple-applications response, not the agent-service `/inspect` response, and
the agent service never sees it. The browser depends on its shape, so it sits at the public edge.

## What crosses the boundary

`GET /api/simple/applications/{id}` returns a `SimpleApplicationResponse`. When the application is
an agent, the handler attaches the overlay under a read-only container:

```jsonc
{
  "application": { /* ... the fetched application ... */ },
  "additional_context": {
    "playground_build_kit": {
      "agent_template_overlay": {        // a partial parameters.agent
        "tools": [
          { "type": "platform", "op": "commit_revision" },
          // a client tool the embed resolver inlines, carrying the required selector + display name
          { "@ag.embed": { "@ag.references": { "workflow": { "slug": "__ag__request_connection" } },
                           "@ag.selector": { "path": "parameters.tool" } },
            "name": "Request connection" }
        ],
        "skills": [
          { "@ag.embed": { "@ag.references": { "workflow": { "slug": "__ag__getting_started_with_agenta" } },
                           "@ag.selector": { "path": "parameters.skill" } },
            "name": "Getting started with Agenta" }
        ],
        "sandbox": { /* build-permission elevation: write files, execute code */ }
      }
    }
  }
}
```

The contract has three load-bearing rules:

- **It is a partial `parameters.agent`, served read-only.** The frontend reads it from this
  response, deep-merges object fields and identity-merges list fields onto `parameters.agent` on a
  kit-on run, and excludes it on commit. The stored revision holds only the user's config. There is
  no run flag and no service-side merge.
- **Each embed carries `@ag.selector`.** Without it the resolver inlines the whole `revision.data`
  (`{uri, parameters: {skill|tool: ...}}`), which the SDK skill parser and the tool coercer both
  reject (HTTP 500). The selector path is `parameters.skill` for a skill and `parameters.tool` for
  a tool.
- **Each embed carries a sibling `name`.** The frontend shows the resolved workflow name, not the
  raw `__ag__*` slug. Resolution replaces the whole entry, so the parser never sees this sibling.

Tool configs are discriminated by `type` (`platform`, `client`, `reference`, ...), not `kind`. The
`request_connection` embed resolves to a `ClientToolConfig` with `render.kind:"connect"`; the
reserved `__ag__*` workflows are code-defined in the static catalog, with no database row.

## Files that own it

- `api/oss/src/apis/fastapi/applications/overlay.py` (`build_agent_template_overlay`,
  `_workflow_embed`) assembles the overlay and the embeds.
- `api/oss/src/apis/fastapi/applications/router.py` (`fetch_simple_application`) attaches it.
- `api/oss/src/apis/fastapi/applications/models.py` (`SimpleApplicationAdditionalContext`,
  `PlaygroundBuildKitContext`, `AgentTemplateOverlay`) types the container.
- `api/oss/src/core/workflows/static_catalog.py` defines the reserved `__ag__*` workflows.
- The frontend applier reads and merges the overlay (`web/packages/agenta-playground/`).

## What to check when you change it

- The overlay stays a partial `parameters.agent` that the SDK parser accepts after resolution. Run
  `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py`, which asserts the canonical
  selector on every embed and an end-to-end overlay -> embed-resolution -> `AgentTemplate.from_params`
  parse.
- Adding a read-only platform hint adds a member beside `playground_build_kit`, never inside
  `revision.data` (user config) or `application.meta` (user metadata).
- A new platform op joins `PLATFORM_OPS` and flows into the overlay automatically; a new reserved
  static tool needs its embed to carry `parameters.tool`.
