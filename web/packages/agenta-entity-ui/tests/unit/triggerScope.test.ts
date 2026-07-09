import {describe, expect, it} from "vitest"

import {
    AGENT_TRIGGER_ORIGIN_META_KEY,
    addAgentTriggerOriginMeta,
    agentTriggerMatchesContext,
    buildAgentTriggerOrigin,
    type AgentTriggerContext,
    type AgentTriggerEntity,
} from "../../src/DrillInView/SchemaControls/triggerScope"

const ids = new Set(["app-1", "variant-a", "rev-2"])

const context: AgentTriggerContext = {
    revisionId: "rev-2",
    variantId: "variant-a",
    revisionVersion: 2,
}

function trigger({
    refs,
    meta,
}: {
    refs?: AgentTriggerEntity["data"]["references"]
    meta?: AgentTriggerEntity["meta"]
}): AgentTriggerEntity {
    return {
        data: {
            event_key: "schedule.tick",
            references: refs,
        },
        meta: meta ?? {},
    }
}

describe("agentTriggerMatchesContext", () => {
    it("keeps legacy variant-bound triggers visible anywhere in the variant", () => {
        expect(
            agentTriggerMatchesContext(
                trigger({refs: {application_variant: {id: "variant-a"}}}),
                context,
                ids,
            ),
        ).toBe(true)
    })

    it("shows origin-scoped triggers on the origin revision and later revisions in the same variant", () => {
        const meta = addAgentTriggerOriginMeta(null, {
            revision_id: "rev-1",
            variant_id: "variant-a",
            revision_version: 1,
        })

        expect(
            agentTriggerMatchesContext(
                trigger({refs: {application_variant: {id: "variant-a"}}, meta}),
                context,
                ids,
            ),
        ).toBe(true)
    })

    it("hides origin-scoped triggers from older revisions in the same variant", () => {
        const meta = addAgentTriggerOriginMeta(null, {
            revision_id: "rev-3",
            variant_id: "variant-a",
            revision_version: 3,
        })

        expect(
            agentTriggerMatchesContext(
                trigger({refs: {application_variant: {id: "variant-a"}}, meta}),
                context,
                ids,
            ),
        ).toBe(false)
    })

    it("hides origin-scoped triggers from sibling variants", () => {
        const meta = addAgentTriggerOriginMeta(null, {
            revision_id: "rev-1",
            variant_id: "variant-b",
            revision_version: 1,
        })

        expect(
            agentTriggerMatchesContext(
                trigger({refs: {application_variant: {id: "variant-b"}}, meta}),
                context,
                ids,
            ),
        ).toBe(false)
    })

    it("still supports exact revision references without origin metadata", () => {
        expect(
            agentTriggerMatchesContext(
                trigger({refs: {application_revision: {id: "rev-2"}}}),
                context,
                ids,
            ),
        ).toBe(true)
    })
})

describe("buildAgentTriggerOrigin", () => {
    it("stores the revision where the trigger was created", () => {
        expect(buildAgentTriggerOrigin(context)).toEqual({
            revision_id: "rev-2",
            variant_id: "variant-a",
            revision_version: 2,
        })
    })

    it("merges the origin marker into existing metadata", () => {
        expect(
            addAgentTriggerOriginMeta({source: "playground"}, buildAgentTriggerOrigin(context)),
        ).toEqual({
            source: "playground",
            [AGENT_TRIGGER_ORIGIN_META_KEY]: {
                revision_id: "rev-2",
                variant_id: "variant-a",
                revision_version: 2,
            },
        })
    })
})
