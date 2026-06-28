# Use-case walkthrough: the Slack support bot, from first principles

This is the use case from the brief, worked end to end. It shows why discovery is expensive
today and what it becomes with `find_capabilities`.

## The request

Build an agent that:

1. listens in a Slack support channel for new messages,
2. searches GitHub issues to see if the message is already tracked,
3. if not, creates a GitHub issue and replies in Slack with a link to it.

Two agents are involved. The **setup agent** wires the tools and creates the worker. The
**worker agent** runs the loop above. They need different things from discovery (see
`design.md`).

## Before: how a naive agent solved it (~20 calls, mostly sequential)

```
GET  /tools/catalog/providers/                                  # what providers exist
GET  /tools/catalog/providers/composio/integrations/?search=slack
GET  /tools/catalog/providers/composio/integrations/?search=github
GET  .../integrations/slack/actions/?query=send                 # guess the query term
GET  .../integrations/github/actions/?query=issue
GET  .../integrations/slack/actions/SLACK_SEND_MESSAGE          # schema, one by one
GET  .../integrations/github/actions/GITHUB_SEARCH_ISSUES
GET  .../integrations/github/actions/GITHUB_CREATE_AN_ISSUE
GET  /triggers/catalog/.../slack/events/?query=message          # the "listen" side
GET  /triggers/catalog/.../slack/events/SLACK_RECEIVE_MESSAGE
POST /tools/connections/query  (slack)                          # does a connection exist?
POST /tools/connections/query  (github)
POST /tools/connections/       (slack)                          # create if missing
POST /tools/connections/       (github)
POST /tools/resolve            (assemble model-ready specs)
... then runtime tool calls
```

Every line depends on the previous. The agent guesses slug names. It stitches three separate
concerns by hand: which action, does a connection exist, what is the schema. It also has to
know that "post to Slack" really needs a find-channel step first, which the one-line request
never said.

## After: one discovery call

The setup agent passes the use case as fragments. Project scope (hence Composio `user_id`)
comes from the run's caller auth.

```
POST /tools/discover
{
  "use_cases": [
    "listen for new messages in a slack support channel",   // trigger; see note below
    "search github issues for a matching report",
    "create a github issue",
    "post a reply in a slack thread with a link"
  ]
}
```

### Real output from `COMPOSIO_SEARCH_TOOLS` (the engine), trimmed

For "post a message to a slack channel" the endpoint returned (verbatim, 2026-06-27):

```jsonc
"primary_tool_slugs": ["SLACK_SEND_MESSAGE"],
"related_tool_slugs": ["SLACK_FIND_CHANNELS", "SLACK_UPDATES_A_SLACK_MESSAGE",
                       "SLACKBOT_SEND_MESSAGE", "SLACK_RETRIEVE_CONVERSATION_INFORMATION",
                       "SLACK_SCHEDULE_MESSAGE", "SLACK_JOIN_AN_EXISTING_CONVERSATION"],
"toolkits": ["slack", "slackbot"],
"recommended_plan_steps": [
  "[Optional ...] Resolve the destination conversation identifier using SLACK_FIND_CHANNELS ...",
  "[Required] Get user confirmation on final content/destination, then post using SLACK_SEND_MESSAGE ...",
  "[Optional Fallback] Join using SLACK_JOIN_AN_EXISTING_CONVERSATION, then retry SLACK_SEND_MESSAGE once ..."
],
"known_pitfalls": [
  "[SLACK_SEND_MESSAGE] Not idempotent — retries can create duplicate posts ...",
  "[SLACK_SEND_MESSAGE] use exactly one of markdown text or blocks ..."
],
"difficulty": "easy"
```

For "create a github issue" the `tool_schemas` came back inline:

```jsonc
"GITHUB_CREATE_AN_ISSUE": {
  "toolkit": "GITHUB", "tool_slug": "GITHUB_CREATE_AN_ISSUE",
  "description": "Creates a new issue in a GitHub repository, requiring the repository to exist ...",
  "input_schema": { "type": "object", "required": ["owner", "repo", "title"],
                    "properties": { "title": {...}, "body": {...}, "repo": {...}, "owner": {...} } },
  "hasFullSchema": true
}
```

And the connection state, read at `user_id = project_id`:

```jsonc
"toolkit_connection_statuses": [
  { "toolkit": "slack",  "has_active_connection": false, "status_message": "No Active connection ..." },
  { "toolkit": "github", "has_active_connection": true }
]
```

### What the setup agent receives, in Agenta terms

`find_capabilities` translates that into the Agenta-native shape (see `design.md` for the full
contract):

```jsonc
{
  "capabilities": [
    { "use_case": "search github issues for a matching report",
      "integration": "github", "tool": { "type":"gateway","provider":"composio",
        "integration":"github","action":"LIST_ISSUES_ASSIGNED_TO_THE_AUTHENTICATED_USER",
        "connection":"github-main", "input_schema": {...} },
      "connection": { "state": "ready", "slug": "github-main" } },

    { "use_case": "create a github issue",
      "integration": "github", "tool": { "type":"gateway","provider":"composio",
        "integration":"github","action":"CREATE_AN_ISSUE","connection":"github-main",
        "input_schema": { "required":["owner","repo","title"], ... } },
      "alternatives": [ {"integration":"github","action":"ADD_LABELS_TO_AN_ISSUE"}, ... ],
      "connection": { "state": "ready", "slug": "github-main" } },

    { "use_case": "post a reply in a slack thread with a link",
      "integration": "slack", "tool": { "type":"gateway","provider":"composio",
        "integration":"slack","action":"SEND_MESSAGE","input_schema": {...} },
      "alternatives": [ {"integration":"slack","action":"FIND_CHANNELS"}, ... ],
      "connection": { "state": "needs_auth" } }
  ],
  "connections": [
    { "integration": "github", "state": "ready", "slug": "github-main" },
    { "integration": "slack",  "state": "needs_auth",
      "connect": { "endpoint": "POST /tools/connections/",
                   "body": { "connection": { "provider_key":"composio",
                             "integration_key":"slack", "slug":"slack-support" } } } }
  ],
  "guidance": {
    "plan_steps": [ "Resolve the channel with slack.FIND_CHANNELS before posting", "..." ],
    "pitfalls":   [ "slack.SEND_MESSAGE is not idempotent; do not retry blindly", "..." ]
  },
  "ready": false
}
```

## Why each piece is useful here

- **The tool + schema** (`create a github issue` -> `github.CREATE_AN_ISSUE` with `required:
  [owner, repo, title]`) drops straight into `agent_config.tools`, and the schema is what the
  worker's model will use to call it. No separate schema fetch.
- **The alternatives** surface `slack.FIND_CHANNELS`, the prerequisite the one-line request
  never mentioned. The setup agent adds it so the worker can resolve a channel before posting.
- **The connection state** is the decision the brief cares about. GitHub is `ready`, so the
  worker reuses `github-main`. Slack is `needs_auth`, so the setup agent surfaces one
  `POST /tools/connections/` call, gets a `redirect_url`, and asks the human to authorize. No
  blind connection query, no guessing.
- **The plan and pitfalls** become the worker's `agents_md`: resolve the channel first, confirm
  before posting, do not retry a non-idempotent send. The worker is more reliable on day one
  because the operating procedure came from the discovery step.

## The trigger ("listen") caveat

`COMPOSIO_SEARCH_TOOLS` returns action tools, not trigger events. The "listen for new messages"
fragment is a Slack trigger (a webhook subscription), which is a separate Agenta subsystem
(`/triggers/...`) and a separate Composio meta-tool ("List Triggers"). The first slice scopes
`find_capabilities` to action tools and returns a clear note that the listen step needs a
trigger subscription. Extending the same pattern to triggers is D5 in `status.md`.

## Call count, before vs after

| | Before | After |
|---|---|---|
| Discovery (find tools, schemas, connection state) | ~13 sequential | 1 |
| Connection setup | up to 4 (query + create per integration) | 0-2 (create only for missing) |
| Create + test the agent | (separate) | 2 (`create_workflow`, `invoke_workflow`) |
| Slug guessing / hand-stitching | constant | none |

Roughly twenty calls collapse to three to five, and the worker gets a better prompt for free.
