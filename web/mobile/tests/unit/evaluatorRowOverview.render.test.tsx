// @vitest-environment jsdom
import {act} from "react"

import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EvaluatorRowCells} from "@/features/evaluators/EvaluatorRowCells"
import type {EvaluatorListRow} from "@/features/evaluators/evaluatorsView"

const {betaAtom} = vi.hoisted(() => ({betaAtom: {current: null as PrimitiveAtom<boolean> | null}}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    betaAtom.current = atom(false)
    return {...original, betaDeveloperModeActiveAtom: betaAtom.current}
})
vi.mock("next/router", () => ({
    useRouter: () => ({query: {workspace_id: "ws-1", project_id: "proj-1"}}),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const ROW: EvaluatorListRow = {
    id: "rev-3",
    key: "eval-1",
    depth: 0,
    hasOlder: true,
    workflowId: "eval-1",
    name: "Answer check",
    slug: "answer-check",
    version: 3,
    createdAt: null,
    updatedAt: null,
    updatedById: null,
    message: null,
    evaluatorKey: "auto_exact_match",
    feedbackKeys: [],
}

let host: HTMLDivElement
let root: Root

const renderRow = async (beta: boolean, category: "automatic" | "human") => {
    const store = createStore()
    if (betaAtom.current) store.set(betaAtom.current, beta)
    await act(async () =>
        root.render(
            <Provider store={store}>
                <EvaluatorRowCells
                    row={ROW}
                    category={category}
                    narrow
                    canEdit={false}
                    expanded={false}
                    loadingOlder={false}
                    onToggleExpand={() => undefined}
                    onOpen={() => undefined}
                />
            </Provider>,
        ),
    )
    const trigger = host.querySelector('[aria-label="Evaluator actions"]')
    // Radix opens a menu on a primary-button pointer down, which jsdom has no PointerEvent for.
    await act(async () => {
        trigger?.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, button: 0}))
    })
}

const overviewItem = () =>
    [...document.body.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === "Overview",
    )

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("an evaluator row's menu", () => {
    it("links to the evaluator's Overview in beta developer mode", async () => {
        await renderRow(true, "automatic")
        expect(overviewItem()?.getAttribute("href")).toBe("/w/ws-1/p/proj-1/apps/eval-1/overview")
    })

    it("has no Overview without beta developer mode", async () => {
        await renderRow(false, "automatic")
        expect(document.body.textContent).toContain("Copy ID")
        expect(overviewItem()).toBeUndefined()
    })

    it("has no Overview for a human evaluator", async () => {
        await renderRow(true, "human")
        expect(document.body.textContent).toContain("Copy ID")
        expect(overviewItem()).toBeUndefined()
    })
})
