// @vitest-environment jsdom
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const {diff} = vi.hoisted(() => ({diff: vi.fn()}))

vi.mock("next/dynamic", () => ({
    default: () => (props: {original: unknown; modified: unknown}) => {
        diff(props)
        return createElement("div", {"data-testid": "diff"})
    },
}))
vi.mock("@agenta/entities/workflow", () => ({
    workflowMolecule: {
        selectors: {
            data: (id: string) => ({id: `revision:${id}`}),
        },
    },
}))
vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: (atom: {id: string}) => ({
        data: {parameters: {prompt: atom.id.replace("revision:", "")}},
    }),
}))
vi.mock("@agenta/entities/shared", () => ({
    UserAuthorLabel: () => createElement("span", null, "Alex"),
}))
vi.mock("@agenta/entity-ui/variant", () => ({
    VariantDetailsWithStatus: ({variantName, revision}: {variantName: string; revision: number}) =>
        createElement("span", null, `${variantName} v${revision}`),
}))

import {CompareRevisionsDialog} from "@/features/variants/CompareRevisionsDialog"
import {selectedPair, toRegistryRows} from "@/features/variants/registryRows"
import type {AppRevisionRow} from "@/features/variants/useAppRevisions"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const revision = (id: string, version: number, createdAt: string) =>
    ({
        revisionId: id,
        workflowId: "app-1",
        variantId: "verbose",
        variantName: "verbose",
        variantSlug: null,
        version,
        model: "",
        message: null,
        createdAt,
        createdById: "u1",
    }) satisfies AppRevisionRow

const NEW = revision("v4", 4, "2026-11-05T19:49:00Z")
const OLD = revision("v3", 3, "2026-11-05T19:47:00Z")

describe("comparing two revisions", () => {
    let root: Root | null = null
    let host: HTMLDivElement | null = null
    afterEach(() => {
        act(() => root?.unmount())
        host?.remove()
        root = null
        document.body.innerHTML = ""
        diff.mockReset()
    })

    it("needs exactly two selected rows", () => {
        const rows = toRegistryRows([NEW, OLD], "revisions", new Set())
        expect(selectedPair(rows, new Set(["v4", "v3"]))?.map((row) => row.revisionId)).toEqual([
            "v4",
            "v3",
        ])
        expect(selectedPair(rows, new Set(["v4"]))).toBeNull()
    })

    it("shows the older revision as the original and diffs the two configs", () => {
        host = document.createElement("div")
        document.body.append(host)
        const mounted = createRoot(host)
        root = mounted
        act(() =>
            mounted.render(
                createElement(CompareRevisionsDialog, {revisions: [NEW, OLD], onClose: vi.fn()}),
            ),
        )
        const text = document.body.textContent ?? ""
        expect(text.indexOf("Original Version")).toBeLessThan(text.indexOf("verbose v3"))
        expect(text.indexOf("verbose v3")).toBeLessThan(text.indexOf("Modified Version"))
        expect(text.indexOf("Modified Version")).toBeLessThan(text.indexOf("verbose v4"))
        expect(diff).toHaveBeenLastCalledWith(
            expect.objectContaining({original: {prompt: "v3"}, modified: {prompt: "v4"}}),
        )
    })
})
