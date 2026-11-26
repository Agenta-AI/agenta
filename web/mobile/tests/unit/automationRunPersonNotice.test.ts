/**
 * The two rules behind the run person notice (spec 3.8 and 5.6): whether a save makes the viewer
 * the automation's run person, and which revision the next run reads, so the notice checks that
 * revision for "user" items.
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
    const automation = (
        references: Record<string, {id?: string; slug?: string; version?: string}>,
    ): Automation =>
        ({
            agentId: "agent-1",
            raw: {data: {references}},
        }) as unknown as Automation

    it("keeps the stored family, the pinned revision included", () => {
        expect(
            automationRevisionRefs(
                automation({workflow: {id: "agent-1"}, workflow_revision: {id: "rev-3"}}),
                "agent-1",
            ),
        ).toEqual({workflow: {id: "agent-1"}, revision: {id: "rev-3"}})
    })

    it("keeps a revision pinned by slug or version, not only by id", () => {
        expect(
            automationRevisionRefs(
                automation({workflow: {id: "agent-1"}, workflow_revision: {slug: "v3-slug"}}),
                null,
            ),
        ).toEqual({workflow: {id: "agent-1"}, revision: {slug: "v3-slug"}})
    })

    it("reads the application family first, as the trigger service does", () => {
        expect(
            automationRevisionRefs(
                automation({application_variant: {id: "var-1"}, workflow: {id: "other"}}),
                "agent-1",
            ),
        ).toEqual({variant: {id: "var-1"}})
    })

    it("reads what Save writes for an unsaved rebind: the agent and its newest variant", () => {
        expect(
            automationRevisionRefs(automation({workflow: {id: "agent-1"}}), "agent-2", "var-9"),
        ).toEqual({workflow: {id: "agent-2"}, variant: {id: "var-9"}})
        expect(automationRevisionRefs(automation({workflow: {id: "agent-1"}}), "agent-2")).toEqual({
            workflow: {id: "agent-2"},
        })
    })

    it("keeps an environment binding, with the agent's slug as the deployment's key", () => {
        expect(
            automationRevisionRefs(
                automation({environment: {slug: "production"}, application: {slug: "support"}}),
                null,
            ),
        ).toEqual({
            workflow: {slug: "support"},
            environment: {slug: "production"},
            key: "support.revision",
        })
    })

    it("has nothing to read without stored references", () => {
        expect(automationRevisionRefs(automation({}), null)).toBeNull()
    })
})
