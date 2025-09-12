import {createStore} from "jotai"

import {
    selectedVariantsAtom,
    viewTypeAtom,
    setSelectedVariantMutationAtom,
    toggleVariantDisplayMutationAtom,
    setDisplayedVariantsMutationAtom,
} from "../index"

describe("Playground Core Atoms", () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        store = createStore()
    })

    describe("selectedVariantsAtom", () => {
        it("should initialize with empty array", () => {
            const selectedVariants = store.get(selectedVariantsAtom)
            expect(selectedVariants).toEqual([])
        })

        it("should update selected variants", () => {
            store.set(selectedVariantsAtom, ["variant-1", "variant-2"])
            const selectedVariants = store.get(selectedVariantsAtom)
            expect(selectedVariants).toEqual(["variant-1", "variant-2"])
        })
    })

    describe("viewTypeAtom", () => {
        it("should initialize with single view", () => {
            const viewType = store.get(viewTypeAtom)
            expect(viewType).toBe("single")
        })

        it("should update view type", () => {
            store.set(viewTypeAtom, "comparison")
            const viewType = store.get(viewTypeAtom)
            expect(viewType).toBe("comparison")
        })
    })

    describe("setSelectedVariantMutationAtom", () => {
        it("should set single variant and switch to single view", () => {
            store.set(setSelectedVariantMutationAtom, "variant-1")

            const selectedVariants = store.get(selectedVariantsAtom)
            const viewType = store.get(viewTypeAtom)

            expect(selectedVariants).toEqual(["variant-1"])
            expect(viewType).toBe("single")
        })
    })

    describe("toggleVariantDisplayMutationAtom", () => {
        it("should add variant when not present", () => {
            store.set(toggleVariantDisplayMutationAtom, "variant-1")

            const selectedVariants = store.get(selectedVariantsAtom)
            expect(selectedVariants).toEqual(["variant-1"])
        })

        it("should remove variant when present", () => {
            store.set(selectedVariantsAtom, ["variant-1", "variant-2"])
            store.set(toggleVariantDisplayMutationAtom, "variant-1")

            const selectedVariants = store.get(selectedVariantsAtom)
            expect(selectedVariants).toEqual(["variant-2"])
        })

        it("should switch to comparison view when multiple variants", () => {
            store.set(selectedVariantsAtom, ["variant-1"])
            store.set(toggleVariantDisplayMutationAtom, "variant-2")

            const viewType = store.get(viewTypeAtom)
            expect(viewType).toBe("comparison")
        })
    })

    describe("setDisplayedVariantsMutationAtom", () => {
        it("should set multiple variants and switch to comparison view", () => {
            store.set(setDisplayedVariantsMutationAtom, ["variant-1", "variant-2"])

            const selectedVariants = store.get(selectedVariantsAtom)
            const viewType = store.get(viewTypeAtom)

            expect(selectedVariants).toEqual(["variant-1", "variant-2"])
            expect(viewType).toBe("comparison")
        })

        it("should set single variant and switch to single view", () => {
            store.set(setDisplayedVariantsMutationAtom, ["variant-1"])

            const selectedVariants = store.get(selectedVariantsAtom)
            const viewType = store.get(viewTypeAtom)

            expect(selectedVariants).toEqual(["variant-1"])
            expect(viewType).toBe("single")
        })
    })
})
