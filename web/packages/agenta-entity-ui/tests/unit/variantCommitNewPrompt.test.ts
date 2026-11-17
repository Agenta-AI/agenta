/**
 * A new prompt (a local draft from a template) has no saved side, so the create dialog must not
 * list its template values as changes the user made.
 */
import {atom, createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/entities/workflow")>()
    return {
        ...original,
        workflowMolecule: {
            ...original.workflowMolecule,
            selectors: {
                ...original.workflowMolecule.selectors,
                data: () =>
                    atom({
                        id: "local-1",
                        version: null,
                        data: {
                            parameters: {
                                prompt: {
                                    messages: [{role: "system", content: "You are helpful"}],
                                    llm_config: {model: "gpt-4o-mini"},
                                },
                            },
                        },
                    }),
                serverData: () => atom(null),
            },
        },
        workflowRevisionRefsByVariantAtomFamily: () => atom([]),
        workflowVariantNewestVersionAtomFamily: () => atom(null),
    }
})

import {variantModalAdapter} from "../../src/adapters/variantAdapters"

describe("variant commit dialog: new prompt", () => {
    it("lists no changes and suggests a first-version message", () => {
        const context = createStore().get(variantModalAdapter.commitContextAtom!("local-1"))
        expect(context?.sections).toBeUndefined()
        expect(context?.diffData).toBeUndefined()
        expect(context?.suggestedMessage).toBe("First version")
    })
})
