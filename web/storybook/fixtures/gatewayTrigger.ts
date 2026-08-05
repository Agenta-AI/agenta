import {
    triggerCatalogIntegrationsResponseSchema,
    triggerConnectionsResponseSchema,
    triggerSchedulesResponseSchema,
    triggerSubscriptionsResponseSchema,
    type TriggerSchedule,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {workflowSchema, type Workflow} from "@agenta/entities/workflow"
import type {QueryKey} from "@tanstack/react-query"

import type {StoryScope} from "../.storybook/decorators/withAgentaData"

/**
 * Fixture builders for the agent config panel's **Triggers** section
 * (`@agenta/entity-ui/drill-in` → `TriggerManagementSection`).
 *
 * Same contract as `workflow.ts` / `entityModals.ts`: every payload goes through the zod
 * schema the API boundary already validates with (`triggerSubscriptionsResponseSchema`,
 * `triggerSchedulesResponseSchema`, `triggerConnectionsResponseSchema`,
 * `triggerCatalogIntegrationsResponseSchema`), so a fixture cannot drift from the backend
 * contract without failing loudly here first.
 *
 * Ids come from the story's `StoryScope` (L1 isolation). NOTE: the three trigger LIST
 * queries are project-agnostic singleton keys (`["triggers","subscriptions"]` etc. — see
 * `gatewayTrigger/hooks/useTriggerSubscriptions.ts:13`), so they cannot be scoped; what IS
 * scoped is the agent the section filters against, which is what the section actually reads.
 */

const TIMESTAMPS = {created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"}

export interface TriggerSectionIds {
    projectId: string
    workflowId: string
    variantId: string
    revisionId: string
    connectionId: string
}

export function triggerSectionIds(scope: StoryScope): TriggerSectionIds {
    return {
        projectId: scope.projectId,
        workflowId: scope.id("wf"),
        variantId: scope.id("var"),
        revisionId: scope.id("rev"),
        connectionId: scope.id("conn"),
    }
}

/** The agent revision the section is scoped to (`useAgentTriggers` reads its parent ids). */
export function triggerAgentRevision(ids: TriggerSectionIds): Workflow {
    return workflowSchema.parse({
        id: ids.revisionId,
        slug: "support-agent",
        name: "default",
        version: 4,
        workflow_id: ids.workflowId,
        workflow_variant_id: ids.variantId,
        flags: {is_agent: true, is_application: true},
        ...TIMESTAMPS,
    })
}

/** The workflow artifact — the section's `defaultBoundLabel` ("bound to <name>"). */
export function triggerAgentArtifact(ids: TriggerSectionIds, name = "Support Agent"): Workflow {
    return workflowSchema.parse({
        id: ids.workflowId,
        slug: "support-agent",
        name,
        flags: {is_agent: true, is_application: true},
        ...TIMESTAMPS,
    })
}

/** A subscription bound to the agent — `data.references` is what the section filters on. */
export function triggerSubscription(
    ids: TriggerSectionIds,
    overrides: {
        id: string
        name?: string | null
        eventKey: string
        active?: boolean
    },
): TriggerSubscription {
    return triggerSubscriptionsResponseSchema.parse({
        count: 1,
        subscriptions: [
            {
                id: overrides.id,
                name: overrides.name ?? null,
                connection_id: ids.connectionId,
                flags: {is_active: overrides.active ?? true, is_valid: true, is_test: false},
                data: {
                    event_key: overrides.eventKey,
                    references: {application_variant: {id: ids.variantId}},
                },
                ...TIMESTAMPS,
            },
        ],
    }).subscriptions[0]
}

/** A schedule bound to the agent. `inputs_fields.messages` drives the row's subtitle. */
export function triggerSchedule(
    ids: TriggerSectionIds,
    overrides: {
        id: string
        name?: string | null
        cron: string
        message?: string
        active?: boolean
    },
): TriggerSchedule {
    return triggerSchedulesResponseSchema.parse({
        count: 1,
        schedules: [
            {
                id: overrides.id,
                name: overrides.name ?? null,
                flags: {is_active: overrides.active ?? true},
                data: {
                    event_key: "schedule",
                    schedule: overrides.cron,
                    inputs_fields: overrides.message
                        ? {messages: [{role: "user", content: overrides.message}]}
                        : {},
                    references: {application_variant: {id: ids.variantId}},
                },
                ...TIMESTAMPS,
            },
        ],
    }).schedules[0]
}

/** The section's full query set: agent identity + the four trigger list/catalog caches. */
export function triggerSectionQueries(
    scope: StoryScope,
    opts?: {
        subscriptions?: TriggerSubscription[]
        schedules?: TriggerSchedule[]
        integrationName?: string
    },
): [QueryKey, unknown][] {
    const ids = triggerSectionIds(scope)
    const subscriptions = opts?.subscriptions ?? []
    const schedules = opts?.schedules ?? []
    const integrationName = opts?.integrationName ?? "Slack"

    return [
        // workflowQueryAtomFamily               → workflow/state/store.ts:1187
        //   feeds useAgentTriggers' revisionMeta (app id / variant id / slug)
        [["workflows", "revision", ids.revisionId, ids.projectId], triggerAgentRevision(ids)],
        // workflowArtifactScopedQueryAtomFamily → workflow/state/store.ts:1101
        //   feeds workflowMolecule.selectors.artifactName → defaultBoundLabel
        [["workflows", "artifact", ids.workflowId, ids.projectId], triggerAgentArtifact(ids)],
        // triggerSubscriptionsQueryAtom         → gatewayTrigger/hooks/useTriggerSubscriptions.ts:13
        [
            ["triggers", "subscriptions"],
            triggerSubscriptionsResponseSchema.parse({
                count: subscriptions.length,
                subscriptions,
            }),
        ],
        // triggerSchedulesQueryAtom             → gatewayTrigger/hooks/useTriggerSchedules.ts:12
        [
            ["triggers", "schedules"],
            triggerSchedulesResponseSchema.parse({count: schedules.length, schedules}),
        ],
        // triggerConnectionsQueryAtom           → gatewayTrigger/hooks/useTriggerConnections.ts:14
        //   maps subscription.connection_id → the provider group (integration_key)
        [
            ["triggers", "connections"],
            triggerConnectionsResponseSchema.parse({
                count: 1,
                connections: [
                    {
                        id: ids.connectionId,
                        name: `${integrationName} workspace`,
                        slug: integrationName.toLowerCase(),
                        provider_key: "composio",
                        integration_key: integrationName.toLowerCase(),
                        ...TIMESTAMPS,
                    },
                ],
            }),
        ],
        // triggerCatalogIntegrationsInfiniteAtom → gatewayTrigger/hooks/useTriggerCatalogIntegrations.ts:23
        //   an INFINITE query — the cache entry is {pages, pageParams}, not the bare response
        [
            ["triggers", "catalog", "integrations", "composio", ""],
            {
                pages: [
                    triggerCatalogIntegrationsResponseSchema.parse({
                        count: 1,
                        total: 1,
                        cursor: null,
                        integrations: [
                            {
                                key: integrationName.toLowerCase(),
                                name: integrationName,
                                categories: [],
                            },
                        ],
                    }),
                ],
                pageParams: [""],
            },
        ],
    ]
}
