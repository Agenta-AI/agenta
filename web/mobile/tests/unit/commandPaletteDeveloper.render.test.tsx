// @vitest-environment jsdom
import {act} from "react"

import type {CommandPaletteGroup} from "@agenta/navigation-ui"
import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {betaAtom, openAtom, reads} = vi.hoisted(() => ({
    betaAtom: {current: null as PrimitiveAtom<boolean> | null},
    openAtom: {current: null as PrimitiveAtom<boolean> | null},
    reads: {prompts: 0, evaluators: 0},
}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom: makeAtom} = await import("jotai")
    betaAtom.current = makeAtom(false)
    return {...original, betaDeveloperModeActiveAtom: betaAtom.current}
})
vi.mock("@agenta/navigation", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom: makeAtom} = await import("jotai")
    openAtom.current = makeAtom(false)
    return {
        ...original,
        sidebarSessionSearchOpenAtom: openAtom.current,
        sidebarSessionSearchResultsAtom: makeAtom([]),
        sidebarSessionSearchLoadingAtom: makeAtom(false),
    }
})
vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom: makeAtom} = await import("jotai")
    const app = {id: "app-1", name: "Capital finder"}
    const judge = {id: "ev-1", name: "Capital judge", flags: {}}
    return {
        ...original,
        agentWorkflowsListQueryStateAtom: makeAtom({data: [], isPending: false}),
        promptWorkflowsListQueryStateAtom: makeAtom(() => {
            reads.prompts += 1
            return {data: [app], isPending: false, isError: false, error: null}
        }),
        nonArchivedEvaluatorsAtom: makeAtom(() => {
            reads.evaluators += 1
            return [judge]
        }),
    }
})
vi.mock("@/features/nav/useMobileNavItems", async () => {
    const {atom: makeAtom} = await import("jotai")
    return {
        mobileSessionsEntity: {
            activeSourceAtom: makeAtom({status: "idle", refs: []}),
            getLabel: () => "",
        },
    }
})
vi.mock("@/features/settings/settingsTabs", () => ({
    AVAILABLE_SETTINGS_TABS: [],
    useMobileSettingsAccess: () => ({}),
}))

import {useCommandPaletteGroups} from "@/features/nav/useCommandPaletteGroups"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const P = "/w/ws-1/p/proj-1"

describe("the command palette in beta developer mode", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>
    let groups: CommandPaletteGroup[] = []

    const Probe = ({query}: {query: string}) => {
        groups = useCommandPaletteGroups(P, query).groups
        return null
    }
    const render = (beta: boolean, open: boolean, query: string) => {
        store.set(betaAtom.current!, beta)
        store.set(openAtom.current!, open)
        act(() =>
            root.render(
                <Provider store={store}>
                    <Probe query={query} />
                </Provider>,
            ),
        )
        const byKey = Object.fromEntries(groups.map((group) => [group.key, group.entries]))
        return {keys: groups.map((group) => group.key), byKey}
    }

    beforeEach(() => {
        host = document.createElement("div")
        root = createRoot(host)
        store = createStore()
        store.set(activeUserIdAtom, "u1")
        reads.prompts = 0
        reads.evaluators = 0
    })
    afterEach(() => act(() => root.unmount()))

    it("finds developer pages, prompt apps and evaluators", () => {
        const {byKey} = render(true, true, "capital")
        expect(byKey.prompts.map((entry) => [entry.label, entry.href])).toEqual([
            ["Capital finder", `${P}/apps/app-1/playground`],
        ])
        expect(byKey.evaluators.map((entry) => [entry.label, entry.href])).toEqual([
            ["Capital judge", `${P}/evaluators?tab=automatic`],
        ])
        const pages = render(true, true, "evaluation").byKey.pages.map((entry) => entry.label)
        expect(pages).toEqual(["Evaluation runs"])
        const all = render(true, true, "").byKey.pages.map((entry) => entry.label)
        expect(all).toEqual(
            expect.arrayContaining([
                "Prompts",
                "Test sets",
                "Evaluators",
                "Evaluation runs",
                "Annotation Queues",
                "Observability",
            ]),
        )
    })

    it("loads the prompt apps and evaluators only once the palette is open with a query", () => {
        render(true, false, "capital")
        render(true, true, "")
        expect(reads).toEqual({prompts: 0, evaluators: 0})
    })

    it("without beta developer mode it lists no developer page, prompt app or evaluator", () => {
        const {keys, byKey} = render(false, true, "")
        expect(keys).toEqual(["sessions", "agents", "pages", "settings", "actions"])
        expect(byKey.pages.map((entry) => entry.label)).toEqual([
            "Home",
            "Agents",
            "Automations",
            "Skills",
            "Sessions",
            "Templates",
            "Settings",
        ])
        render(false, true, "capital")
        expect(reads).toEqual({prompts: 0, evaluators: 0})
    })
})
