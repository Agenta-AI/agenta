/**
 * The tree popup's states: one message at a time while lists load, and the current revision
 * marked even when it is disabled because it is already on screen.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {mode} = vi.hoisted(() => ({
    mode: {
        treeData: [] as unknown[],
        isLoadingParents: false,
        isLoadingChildren: false,
    },
}))

vi.mock("../../src/selection/hooks", () => ({
    useTreeSelectMode: () => ({
        treeData: mode.treeData,
        handleSelect: vi.fn(),
        searchTerm: "",
        setSearchTerm: vi.fn(),
        expandedKeys: ["variant-1"],
        setExpandedKeys: vi.fn(),
        isLoadingParents: mode.isLoadingParents,
        isLoadingChildren: mode.isLoadingChildren,
        parentsError: null,
        adapter: {emptyMessage: "No applications found", loadingMessage: "Loading applications…"},
    }),
}))

import {TreeSelectPopupContent} from "../../src/selection/components/UnifiedEntityPicker/variants/TreeSelectPopupContent"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root
let host: HTMLDivElement

const render = (props: Record<string, unknown> = {}) =>
    act(() => {
        root.render(
            createElement(TreeSelectPopupContent, {
                adapter: {} as never,
                onSelect: vi.fn(),
                showSearch: false,
                ...props,
            }),
        )
    })

beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    mode.treeData = []
    mode.isLoadingParents = false
    mode.isLoadingChildren = false
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("TreeSelectPopupContent", () => {
    it("While the lists load it shows the loading line only, not the empty message", () => {
        mode.isLoadingChildren = true
        render()
        expect(host.textContent).toContain("Loading applications…")
        expect(host.textContent).not.toContain("No applications found")
    })

    it("Once loaded with nothing, it shows the empty message", () => {
        render()
        expect(host.textContent).toContain("No applications found")
    })

    it("The current revision stays marked when it is disabled", () => {
        mode.treeData = [
            {
                key: "variant-1",
                value: "variant-1",
                title: "default",
                selectable: false,
                children: [
                    {
                        key: "rev-1",
                        value: "rev-1",
                        title: "v1",
                        selectable: true,
                        disabled: true,
                        parentId: "variant-1",
                    },
                ],
            },
        ]
        render({selectedValue: "rev-1"})
        const row = host.querySelector('[data-selected="true"] [data-row]')
        expect(row?.className).toContain("bg-controlItemBgActive")
    })
})
