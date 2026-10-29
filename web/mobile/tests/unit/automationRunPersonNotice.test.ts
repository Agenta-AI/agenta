/**
 * The run person notice shows only when saving makes the viewer the automation's run person and
 * the agent has "user" items (spec 3.8 and 5.6).
 */
import {
    automationRevisionRefs,
    runPersonNoticeShown,
    saveChangesRunPerson,
    type Automation,
} from "@agenta/automation-ui"
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

describe("runPersonNoticeShown", () => {
    const base = {
        dirty: true,
        principal: {kind: "human", id: "someone-else"},
        viewerId: viewer,
        agentHasUserItems: true,
    }

    it("shows when a save changes the run person of an agent with user items", () => {
        expect(runPersonNoticeShown(base)).toBe(true)
    })

    it("hides without user items, without an edit, or for the run person", () => {
        expect(runPersonNoticeShown({...base, agentHasUserItems: false})).toBe(false)
        expect(runPersonNoticeShown({...base, dirty: false})).toBe(false)
        expect(runPersonNoticeShown({...base, principal: {kind: "human", id: viewer}})).toBe(false)
    })
})

describe("automationRevisionRefs", () => {
    const automation = (references: Record<string, {id: string}>): Automation =>
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
        expect(
            automationRevisionRefs(automation({workflow: {id: "agent-1"}}), "agent-2"),
        ).toEqual({workflowId: "agent-2"})
    })
})
