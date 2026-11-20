import type {Workflow} from "@agenta/entities/workflow"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {variantNameCellQueries, workflowIds, workflowRevision, type WorkflowIds} from "../workflow"

import {configSliceQueries} from "./foundation-a2"
import {AGENT_SCHEMA, makeAgentConfigFixture} from "./index"

/**
 * The skill registry of canvas F04 f2: five skills, "ticket-triage" and "plain-writing" already on
 * the agent "Support triage", "pdf-reader" imported from acme/skills, "weekly-digest" with no
 * description.
 */

const REGISTRY = [
    {
        slug: "ticket-triage-8f2a",
        name: "ticket-triage",
        description: "Decides urgency and category of a support ticket",
    },
    {
        slug: "plain-writing-4k2p",
        name: "plain-writing",
        description: "Writes replies in plain words",
    },
    {
        slug: "refund-check-7c1d",
        name: "refund-check",
        description: "Checks if a charge can be refunded",
    },
    {
        slug: "pdf-reader-2b9e",
        name: "pdf-reader",
        description: "Reads tables from PDF invoices",
        origin: {repository: "acme/skills"},
    },
    {slug: "weekly-digest-5e3f", name: "weekly-digest"},
]

const embed = (slug: string, name: string) => ({
    name,
    "@ag.embed": {
        "@ag.references": {workflow: {slug}},
        "@ag.selector": {path: "parameters.skill"},
    },
})

const registryList = (scope: StoryScope, skills: typeof REGISTRY) => ({
    count: skills.length,
    skills: skills.map((skill) => ({
        id: scope.id(`skill-${skill.name}`),
        workflow_id: scope.id(`skill-${skill.name}`),
        workflow_slug: skill.slug,
        skill_name: skill.name,
        description: skill.description,
        version: "v1",
        ...(skill.origin ? {origin: skill.origin} : {}),
    })),
    builtin: [],
})

/** The agent with two registry skills, and the registry list the "Add skills" view reads. */
export function skillNewQueries(
    scope: StoryScope,
    {emptyRegistry = false}: {emptyRegistry?: boolean} = {},
): [readonly unknown[], unknown][] {
    const fixture = makeAgentConfigFixture(scope)
    const agent = {
        ...fixture.value,
        skills: [
            embed(REGISTRY[0].slug, "ticket-triage"),
            embed(REGISTRY[1].slug, "plain-writing"),
        ],
    }
    const revision = (ids: WorkflowIds): Workflow =>
        workflowRevision(ids, {
            name: "Support triage",
            data: {
                uri: "agenta:builtin:agent:v0",
                parameters: {agent},
                schemas: {parameters: {type: "object", properties: {agent: AGENT_SCHEMA}}},
            },
        } as Partial<Workflow>)
    const list = registryList(scope, emptyRegistry ? [] : REGISTRY)
    return [
        ...fixture.queries,
        ...variantNameCellQueries(scope, {revision}),
        [["skills", "registry", "list", scope.projectId, "", false], list],
        [["skills", "registry", "list", scope.projectId, "", true], list],
    ]
}

/** The Agent tab of the first slice, with its two agent-only skills, for the "+" menu and the remove dialog. */
export const skillNewAgentTabQueries = (scope: StoryScope): [readonly unknown[], unknown][] => [
    ...configSliceQueries(scope),
    [["vault", "secrets", undefined, scope.projectId], []],
    [["skills", "registry", "list", scope.projectId, "", false], registryList(scope, REGISTRY)],
]

export const skillNewRevisionId = (scope: StoryScope): string => workflowIds(scope).revisionId
