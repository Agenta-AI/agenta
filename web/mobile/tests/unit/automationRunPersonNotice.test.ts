/**
 * The run person notice shows only when saving makes the viewer the automation's run person and
 * the agent has "user" items (spec 3.8 and 5.6). The notice checks the revision the next run uses.
 */
import {automationRevisionRefs, saveChangesRunPerson, type Automation} from "@agenta/automation-ui"
import {describe, expect, it} from "vitest"

const viewer = "user-viewer"

describe("saveChangesRunPerson", () => {
    it("is false when the viewer already is the run person", () => {
        expect(saveChangesRunPerson({kind: "human", id: viewer}, viewer)).toBe(false)
    })

    it("is true for another person, an API key, or no principal", () => {
        expect(saveChangesRunPerson({kind: "human", id: "someone-else"}, viewer)).toBe(true)
        expect(saveChangesRunPerson({kind: "api_key", id: viewer}, viewer)).toBe(true)
        expect(saveChangesRunPerson(null, viewer)).toBe(true)
    })

    it("is false before the viewer is known", () => {
        expect(saveChangesRunPerson(null, null)).toBe(false)
    })
})

describe("automationRevisionRefs", () => {
    const automation = (references: Record<string, {id?: string; slug?: string}>): Automation =>
        ({
            agentId: "agent-1",
            raw: {data: {references}},
        }) as unknown as Automation

    it("resolves the stored references, the pinned revision first", () => {
        expect(
            automationRevisionRefs(
                automation({workflow: {id: "agent-1"}, workflow_revision: {id: "rev-3"}}),
                "agent-1",
            ),
        ).toEqual({workflowId: "agent-1", variantId: undefined, revisionId: "rev-3"})
    })

    it("reads the application family too", () => {
        expect(
            automationRevisionRefs(automation({application_variant: {id: "var-1"}}), "agent-1"),
        ).toMatchObject({variantId: "var-1"})
    })

    it("resolves the newest revision of the agent an unsaved rebind names", () => {
        expect(automationRevisionRefs(automation({workflow: {id: "agent-1"}}), "agent-2")).toEqual({
            workflowId: "agent-2",
        })
    })

    it("keeps an environment binding, with the agent's slug for the deployment's key", () => {
        expect(
            automationRevisionRefs(
                automation({environment: {slug: "production"}, application: {slug: "support"}}),
                null,
            ),
        ).toEqual({
            environment: {id: null, slug: "production"},
            workflowId: "agent-1",
            workflowSlug: "support",
        })
    })
})
