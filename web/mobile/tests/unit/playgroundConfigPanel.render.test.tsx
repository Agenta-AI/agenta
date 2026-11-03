// @vitest-environment jsdom
/**
 * The prompt playground's config panel (`@agenta/playground-ui/panels/config`): its header names
 * the revision, its view switch drives the config editor, and the editor waits for pending
 * hydration. The editor itself is replaced by a stub that records its props.
 */
import {act, useState} from "react"

import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {sectionProps, revisions, pending, cached} = vi.hoisted(() => ({
    sectionProps: [] as Record<string, unknown>[],
    revisions: {} as Record<string, {name: string; version: number; workflow_id: string}>,
    pending: new Set<string>(),
    /** One atom per key, as an atom family gives: a new atom each render never settles. */
    cached: async <T,>(make: (key: string) => T) => {
        const {atom} = await import("jotai")
        const atoms = new Map<string, ReturnType<typeof atom<T>>>()
        return (key: string) => {
            if (!atoms.has(key)) atoms.set(key, atom(make(key)))
            return atoms.get(key)!
        }
    },
}))

vi.mock("@agenta/entity-ui/drill-in", () => ({
    PlaygroundConfigSection: (props: Record<string, unknown>) => {
        sectionProps.push(props)
        return <div data-testid="config-section" />
    },
}))
vi.mock("@agenta/entities/workflow", async (original) => {
    const actual = await original<typeof import("@agenta/entities/workflow")>()
    return {
        ...actual,
        workflowLatestRevisionIdAtomFamily: await cached(() => "rev-latest"),
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                data: await cached((id) => revisions[id] ?? null),
                isDirty: await cached((id) => id.startsWith("local-")),
            },
        },
    }
})
vi.mock("@agenta/entities/environment", async (original) => {
    const actual = await original<typeof import("@agenta/entities/environment")>()
    return {
        ...actual,
        environmentMolecule: {
            ...actual.environmentMolecule,
            atoms: {
                ...actual.environmentMolecule.atoms,
                revisionDeployment: await cached(() => []),
            },
        },
    }
})
vi.mock("@agenta/playground", async (original) => {
    const actual = await original<typeof import("@agenta/playground")>()
    const {atom} = await import("jotai")
    const atoms = new Map<string, ReturnType<typeof atom<boolean>>>()
    // A derived atom: each test renders in a new store, so it reads that test's `pending` set.
    const hasPending = (id: string) => {
        if (!atoms.has(id)) atoms.set(id, atom(() => pending.has(id)))
        return atoms.get(id)!
    }
    return {...actual, hasPendingHydrationAtomFamily: hasPending}
})

import {PlaygroundConfigPanel} from "@agenta/playground-ui/panels/config"

let root: Root
let host: HTMLDivElement

/** The screen owns the view mode; this host plays the screen. */
const Host = ({revisionId}: {revisionId: string}) => {
    const [viewMode, setViewMode] = useState<ConfigViewMode>("form")
    return (
        <PlaygroundConfigPanel
            revisionId={revisionId}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
        />
    )
}

const render = (revisionId: string) => {
    act(() =>
        root.render(
            <Provider store={createStore()}>
                <Host revisionId={revisionId} />
            </Provider>,
        ),
    )
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.releasePointerCapture = () => undefined
    sectionProps.length = 0
    pending.clear()
    revisions["rev-1"] = {name: "default", version: 3, workflow_id: "app-1"}
    revisions["local-1"] = {name: "default", version: 3, workflow_id: "app-1"}
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("PlaygroundConfigPanel", () => {
    it("A saved revision shows its variant name and version", () => {
        render("rev-1")

        expect(host.textContent).toContain("default")
        expect(host.textContent).toContain("v3")
        expect(host.textContent).not.toContain("Draft")
    })

    it("A local draft shows the Draft badge and its source revision", () => {
        render("local-1")

        expect(host.textContent).toContain("Draft")
        expect(host.textContent).toContain("from default v3")
    })

    it("Switching to JSON passes json to the config section", async () => {
        render("rev-1")
        expect(sectionProps.at(-1)).toMatchObject({revisionId: "rev-1", viewMode: "form"})

        const trigger = host.querySelector<HTMLElement>('[aria-label="Config view"]')!
        await act(async () =>
            trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
        )
        const json = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (option) => option.textContent === "JSON",
        )!
        await act(async () => json.click())

        expect(sectionProps.at(-1)).toMatchObject({viewMode: "json"})
    })

    it("The config section waits for pending hydration", () => {
        pending.add("rev-1")
        render("rev-1")

        expect(sectionProps).toHaveLength(0)
        expect(host.querySelector('[data-testid="config-panel-skeleton"]')).not.toBeNull()
    })
})
