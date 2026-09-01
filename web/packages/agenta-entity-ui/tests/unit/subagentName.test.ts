/** A renamed agent must not keep its old name in the parents that call it (#6444).
 *
 * The stored reference used to carry a COPY of the target's name, taken when the subagent was
 * added. A rename never reached it, so the row, the drawer header and the tool the model sees all
 * kept the dead name until the subagent was removed and added again. The slug is now the only
 * identity stored, and the name is read live off the agent it points at. */
import {describe, expect, it} from "vitest"

import {describeSubagent} from "../../src/DrillInView/SchemaControls/agentTemplate/itemDescriptors"
import {normalizeSubagentReference} from "../../src/DrillInView/SchemaControls/agentTemplate/subagentReference"

const legacy = {
    type: "reference",
    ref_by: "variant",
    slug: "helper-9f21",
    name: "Helper One",
    description: "Helps.",
}

describe("normalizeSubagentReference", () => {
    it("drops the name copy, so no write can reintroduce the staleness", () => {
        const saved = normalizeSubagentReference(legacy)
        expect(saved).not.toHaveProperty("name")
        expect(saved).toMatchObject({type: "reference", ref_by: "variant", slug: "helper-9f21"})
    })

    it("keeps the description, which is authored on the reference itself", () => {
        expect(normalizeSubagentReference(legacy).description).toBe("Helps.")
    })

    it("still drops the legacy pins it always dropped", () => {
        const saved = normalizeSubagentReference({...legacy, version: "2", variant_id: "v1"})
        expect(saved).not.toHaveProperty("version")
        expect(saved).not.toHaveProperty("variant_id")
    })
})

describe("describeSubagent", () => {
    it("shows the target's current name, not the copy saved beside it", () => {
        expect(describeSubagent(legacy, undefined, "Helper Two").name).toBe("Helper Two")
    })

    it("falls back to the stored copy while the artifact is still resolving", () => {
        // A raw slug would be a worse placeholder than the name the row showed a moment ago.
        expect(describeSubagent(legacy).name).toBe("Helper One")
    })

    it("falls back to the slug for a reference saved without a name", () => {
        const saved = normalizeSubagentReference(legacy)
        expect(describeSubagent(saved).name).toBe("helper-9f21")
    })
})
