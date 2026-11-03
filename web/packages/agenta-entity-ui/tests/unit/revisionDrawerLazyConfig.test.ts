/**
 * Speed guard: importing `@agenta/entity-ui/variant` must not load the drill-in config pane.
 *
 * Pages import the variant entry for small cells (`VariantNameCell`, ...). The revision drawer
 * lives in the same entry, and its config pane wraps the whole drill-in editor, so the drawer
 * loads that pane with a dynamic import when a revision renders. A `vi.mock` factory runs only
 * when its module is first imported, so each factory below records whether the module loaded.
 */
import {describe, expect, it, vi} from "vitest"

const {loaded} = vi.hoisted(() => ({loaded: new Set<string>()}))

vi.mock("../../src/DrillInView/components/PlaygroundConfigSection", () => {
    loaded.add("PlaygroundConfigSection")
    return {default: () => null}
})
vi.mock("../../src/DrillInView", () => {
    loaded.add("DrillInView")
    return {}
})

// A cold transform of the real entry takes longer than the default 5 s.
describe("RevisionDrawer lazy config pane", {timeout: 120_000}, () => {
    it("Importing the variant entry does not load the config pane", async () => {
        const entry = await import("../../src/variant")
        expect(entry.RevisionDrawer).toBeTypeOf("function")
        expect([...loaded]).toEqual([])
    })

    it("The config pane loads when the drawer asks for it", async () => {
        await import("../../src/variant/RevisionDrawer/RevisionConfigView")
        expect(loaded.has("PlaygroundConfigSection")).toBe(true)
    })
})
