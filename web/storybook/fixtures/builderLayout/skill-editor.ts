import type {Workflow} from "@agenta/entities/workflow"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {variantNameCellQueries, workflowIds, workflowRevision, type WorkflowIds} from "../workflow"

import {AGENT_SCHEMA, makeAgentConfigFixture} from "./index"

/**
 * The skill "ticket-triage" with the 14 files of canvas K01 and F07, as an agent-only skill of
 * Support triage, and "plain-writing" as a registry skill the agent references.
 */

const placeholder = (path: string) => `# ${path}\n\nPlaceholder text for ${path}.\n`

export const TICKET_TRIAGE_FILES = [
    "examples.md",
    "references/categories.md",
    "references/urgency-rules.md",
    "references/refund-policy-europe-and-united-kingdom-2026.md",
    "references/escalation-contacts.md",
    "scripts/classify_ticket.py",
    "scripts/fetch_customer_history.py",
    "lib/zendesk_client.py",
    "templates/reply-billing.md",
    "templates/reply-bug.md",
    "templates/reply-account.md",
    "assets/labels.json",
    "tests/sample-tickets.csv",
]

const CLASSIFY_TICKET = `import json, sys
from lib.zendesk_client import get_ticket

CATEGORIES = ["billing", "bug", "account", "other"]

def classify(ticket_id):
    ticket = get_ticket(ticket_id)
    text = ticket["subject"] + " " + ticket["body"]
    ...

if __name__ == "__main__":
    print(json.dumps(classify(sys.argv[1])))
`

export const TICKET_TRIAGE_BODY = `# Ticket triage

Use this skill for every new support ticket.

## Steps

1. Read the whole ticket first, with all earlier messages.
2. Pick one category: billing, bug, account or other.
3. Pick the urgency: high, medium or low. A bug is medium unless money is involved.
4. For billing tickets, read references/refund-policy first.
5. Label the ticket in Zendesk with the category and the urgency.
6. Draft a first reply in plain words. Never send it yourself.

## When you are not sure

Choose the higher urgency and say why in an internal note.`

export const TICKET_TRIAGE = {
    name: "ticket-triage",
    description:
        "Decides the urgency and the category of a support ticket. Use it for every new ticket and when a customer replies to a closed ticket. Do not use it for sales questions or for tickets that are already labeled.",
    body: TICKET_TRIAGE_BODY,
    files: TICKET_TRIAGE_FILES.map((path) => ({
        path,
        content: path === "scripts/classify_ticket.py" ? CLASSIFY_TICKET : placeholder(path),
    })),
}

const PLAIN_WRITING_SLUG = "plain-writing-4k2p"

/** The agent's reference to the registry skill "plain-writing". */
const PLAIN_WRITING_EMBED = {
    name: "plain-writing",
    "@ag.embed": {
        "@ag.references": {workflow: {slug: PLAIN_WRITING_SLUG}},
        "@ag.selector": {path: "parameters.skill"},
    },
}

export const skillItemKeys = {agentOnly: "ticket-triage", registry: PLAIN_WRITING_SLUG}

export function skillEditorQueries(scope: StoryScope): [readonly unknown[], unknown][] {
    const fixture = makeAgentConfigFixture(scope)
    const agent = {...fixture.value, skills: [TICKET_TRIAGE, PLAIN_WRITING_EMBED]}
    const revision = (ids: WorkflowIds): Workflow =>
        workflowRevision(ids, {
            name: "Support triage",
            data: {
                uri: "agenta:builtin:agent:v0",
                parameters: {agent},
                schemas: {parameters: {type: "object", properties: {agent: AGENT_SCHEMA}}},
            },
        } as Partial<Workflow>)
    const skillWorkflowId = scope.id("skill-plain-writing")
    const plainWriting = {
        ...TICKET_TRIAGE,
        name: "plain-writing",
        description: "Writes replies in plain words.",
    }
    return [
        ...fixture.queries,
        ...variantNameCellQueries(scope, {revision}),
        // The registry, archived skills included: what the skill view resolves a slug against.
        [
            ["skills", "registry", "list", scope.projectId, "", true],
            {
                count: 1,
                skills: [
                    {
                        id: skillWorkflowId,
                        workflow_id: skillWorkflowId,
                        workflow_slug: PLAIN_WRITING_SLUG,
                        skill_name: "plain-writing",
                        description: plainWriting.description,
                        version: "v3",
                        files_count: 14,
                    },
                ],
                builtin: [],
            },
        ],
        [
            ["skills", "revisions", scope.projectId, skillWorkflowId],
            [{id: scope.id("skill-rev-3"), version: "3", skill: plainWriting}],
        ],
        [
            ["skills", "usage", scope.projectId, skillWorkflowId],
            {
                referenced_by: [
                    {agent_workflow_id: "a1", agent_name: "Support triage", mode: "latest"},
                    {agent_workflow_id: "a2", agent_name: "Email writer", mode: "latest"},
                    {agent_workflow_id: "a3", agent_name: "Refund desk", mode: "latest"},
                ],
            },
        ],
    ]
}

export const skillEditorRevisionId = (scope: StoryScope): string => workflowIds(scope).revisionId
