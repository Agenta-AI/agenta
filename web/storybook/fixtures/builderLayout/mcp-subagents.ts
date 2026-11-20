import {useMemo} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import type {
    SubagentDetail,
    WorkflowReferenceBridge,
    WorkflowReferenceCatalogEntry,
} from "@agenta/ui/drill-in"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {variantNameCellQueries, workflowIds, workflowRevision, type WorkflowIds} from "../workflow"

import {AGENT_SCHEMA, makeAgentConfigFixture} from "./index"

/**
 * Canvas F03 f1 to f3: the agent "Support triage" calls "Email writer" as a subagent. The other
 * agents of the project come from a bridge, as the host's workflow reference bridge gives them.
 */

const EMAIL_WRITER_DESCRIPTION =
    "Writes a first email for each new lead. Use it after the lead finder returns a company and a contact. Give it the company name, the contact and what we sell. It returns a subject line and an email under 120 words."

const EMAIL_WRITER_AGENTS_MD = [
    "You write a short first email to a new lead.",
    "Keep it under 120 words. Use the lead's first name. Say in one sentence what we sell and why it fits their company.",
    "Never invent a customer name or a number. If you do not know something, leave it out.",
    "End with one clear question that is easy to answer.",
    "",
    "Write in plain words. Do not use a greeting longer than the first name. Do not add a signature: the sender adds it.",
    "If the lead's company sells to other companies, name one result that a company like theirs got. If it sells to people, name one thing a person gets.",
    "Do not attach files and do not add links, except the one link the lead finder gives you.",
].join("\n")

export const EMAIL_WRITER_DETAIL: SubagentDetail = {
    workflowId: "wf-email-writer",
    description: EMAIL_WRITER_DESCRIPTION,
    model: "gpt-5.5-mini",
    provider: "openai",
    integrations: [
        {key: "gmail", name: "Gmail", permission: "Allow all"},
        {key: "hubspot", name: "HubSpot", permission: "Ask for write and delete"},
    ],
    skills: ["cold-email", "plain-writing"],
    instructions: {fileName: "AGENTS.md", text: EMAIL_WRITER_AGENTS_MD, wordCount: 96},
}

/** The project's agents, as the picker lists them. */
const AGENTS = [
    {
        id: "wf-email-writer",
        slug: "email-writer",
        name: "Email writer",
        description: "Writes a first email for each lead",
    },
    {
        id: "wf-lead-finder",
        slug: "lead-finder",
        name: "Lead finder",
        description: "Finds 10 new leads a day",
    },
    {
        id: "wf-refund-checker",
        slug: "refund-checker",
        name: "Refund checker",
        description: "Checks if a charge can be refunded",
    },
    {
        id: "wf-weekly-report",
        slug: "weekly-report",
        name: "Weekly report",
        description: "Summarizes the week for the team",
    },
    {id: "wf-docs-helper", slug: "docs-helper", name: "Docs helper", description: ""},
]

const CATALOG: Record<string, WorkflowReferenceCatalogEntry> = Object.fromEntries(
    AGENTS.map((agent) => [
        agent.slug,
        {type: "agent", workflowId: agent.id, integrations: []} as WorkflowReferenceCatalogEntry,
    ]),
)

export interface SubagentBridgeOptions {
    /** Slugs whose revision could not be read: the picker's last line says how many. */
    failedSlugs?: string[]
    /** The subagent's configuration cannot be read. */
    detailFailed?: boolean
}

const noop = () => undefined

/** The workflow reference bridge with fixed data. Only the members the views use are real. */
export function subagentBridge(options: SubagentBridgeOptions = {}): WorkflowReferenceBridge {
    const failed = new Set(options.failedSlugs ?? [])
    return {
        enabled: true,
        workflows: AGENTS,
        workflowsLoading: false,
        activate: noop,
        resolveInputSchema: async () => null,
        // Stable per set of slugs, as the real query atoms are.
        useWorkflowReferenceCatalog: (slugs: string[]) => {
            const key = slugs.join("\n")
            return useMemo(
                () => ({
                    bySlug: Object.fromEntries(
                        slugs
                            .filter((slug) => !failed.has(slug))
                            .map((slug) => [slug, CATALOG[slug]]),
                    ),
                    failedSlugs: slugs.filter((slug) => failed.has(slug)),
                    loading: false,
                    retry: noop,
                }),
                [key],
            )
        },
        useSubagentDetail: (slug: string) => ({
            detail: !options.detailFailed && slug === "email-writer" ? EMAIL_WRITER_DETAIL : null,
            loading: false,
            failed: Boolean(options.detailFailed),
            retry: noop,
        }),
    } as unknown as WorkflowReferenceBridge
}

/** The agent with "Email writer" as its one subagent, as a saved revision. */
export function subagentQueries(scope: StoryScope): [readonly unknown[], unknown][] {
    const fixture = makeAgentConfigFixture(scope)
    const tools = [
        ...((fixture.value.tools as unknown[]) ?? []),
        {
            type: "reference",
            ref_by: "variant",
            slug: "email-writer",
            description: EMAIL_WRITER_DESCRIPTION,
            input_schema: {type: "object", properties: {}},
        },
    ]
    const revision = (ids: WorkflowIds): Workflow =>
        workflowRevision(ids, {
            name: "Support triage",
            data: {
                uri: "agenta:builtin:agent:v0",
                parameters: {agent: {...fixture.value, tools}},
                schemas: {parameters: {type: "object", properties: {agent: AGENT_SCHEMA}}},
            },
        } as Partial<Workflow>)
    return [...fixture.queries, ...variantNameCellQueries(scope, {revision})]
}

export const subagentRevisionId = (scope: StoryScope): string => workflowIds(scope).revisionId
