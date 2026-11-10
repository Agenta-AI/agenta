// @vitest-environment jsdom
/**
 * The Configuration tab: read-only general fields, the evaluator cards, the collaborators and the
 * delete card. The queue and evaluator stores are atoms keyed by id and the editor is a stub, so
 * no request is sent. In beta developer mode the name and description become fields; the save
 * itself is covered in annotationQueueDetails.render.test.tsx.
 */
import {act, lazy, Suspense} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    version: null as unknown as import("jotai").PrimitiveAtom<number>,
    queue: null as Record<string, unknown> | null,
    evaluators: {} as Record<string, {pending?: boolean; data: unknown; name?: string}>,
    deleteQueue: vi.fn(async (_id: string) => true),
    push: vi.fn(() => Promise.resolve(true)),
    names: {} as Record<string, string>,
}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/shared/state")>()),
        betaDeveloperModeActiveAtom: atom(false),
    }
})
vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
    }
})
vi.mock("@agenta/entities/simpleQueue", async () => {
    const {atom} = await import("jotai")
    fixture.version ??= atom(0)
    // Read through a version atom so a case can swap the queue between renders.
    const queueAtom = atom((get) => (get(fixture.version), fixture.queue))
    return {
        simpleQueueMolecule: {
            selectors: {data: () => queueAtom},
            actions: {
                deleteQueue: atom(null, (_get, _set, id: string) => fixture.deleteQueue(id)),
                edit: atom(null, async () => true),
            },
        },
    }
})
vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/workflow")>()
    // One atom per id and selector: a new atom on every render would render forever.
    fixture.version ??= atom(0)
    const cache = new Map<string, unknown>()
    const cached = <T,>(key: string, read: () => T) => {
        if (!cache.has(key))
            cache.set(
                key,
                atom((get) => (get(fixture.version), read())),
            )
        return cache.get(key) as import("jotai").Atom<T>
    }
    return {
        ...actual,
        workflowMolecule: {
            selectors: {
                query: (id: string) =>
                    cached(`query:${id}`, () => ({
                        isPending: fixture.evaluators[id]?.pending ?? false,
                    })),
                data: (id: string) =>
                    cached(`data:${id}`, () => fixture.evaluators[id]?.data ?? null),
                artifactName: (id: string) =>
                    cached(`name:${id}`, () => fixture.evaluators[id]?.name ?? null),
            },
        },
    }
})
vi.mock("@agenta/entities/shared", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/shared")>()),
    useUserDisplayName: (id: string) => fixture.names[id] ?? null,
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))
vi.mock("next/router", () => ({useRouter: () => ({push: fixture.push})}))
vi.mock("@/features/annotations/ReadOnlyEditor", () => ({
    ReadOnlyEditor: ({value, language}: {value: string; language?: string}) => (
        <pre data-language={language ?? "markdown"}>{value}</pre>
    ),
}))
// `next/dynamic` outside Next: a plain lazy component, so the stubbed editor renders.
vi.mock("next/dynamic", () => ({
    default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
        const Lazy = lazy(async () => ({default: await loader()}))
        const Dynamic = (props: Record<string, unknown>) => (
            <Suspense fallback={null}>
                <Lazy {...props} />
            </Suspense>
        )
        return Dynamic
    },
}))

import {QueueConfigurationTab} from "@/features/annotations/QueueConfigurationTab"

import {fakeStore, resetSession} from "../support/annotationSessionFake"

let host: HTMLDivElement
let root: Root

const HUMAN_EVALUATOR = {
    slug: "tone-review",
    version: 3,
    flags: {is_feedback: true},
    data: {
        uri: "agenta:custom:feedback:v0",
        schemas: {outputs: {properties: {friendly: {type: "boolean"}}}},
    },
}

const render = async (canDelete = true) => {
    fakeStore.set(fixture.version, (n) => n + 1)
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <QueueConfigurationTab
                    queueId="queue-1"
                    canEdit={canDelete}
                    listHref="/w/ws-1/p/proj-1/annotations"
                />
            </Provider>,
        ),
    )
    // Let the lazy editor resolve.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}
const button = (scope: ParentNode, label: string) =>
    Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === label)

const setBeta = (on: boolean) =>
    fakeStore.set(betaDeveloperModeActiveAtom as PrimitiveAtom<boolean>, on)

beforeEach(() => {
    vi.clearAllMocks()
    setBeta(false)
    // The session knows the workflow id and the revision id; only the revision holds the data.
    resetSession({evaluatorIds: ["wf-1"], evaluatorRevisionIds: ["ev-1"]})
    fixture.queue = {
        id: "queue-1",
        name: "Support replies",
        description: "Rate each **reply**.",
        data: {
            kind: "traces",
            repeats: 2,
            assignments: [
                ["u-1", "u-2"],
                ["u-3", "u-1"],
            ],
        },
    }
    fixture.evaluators = {"ev-1": {data: HUMAN_EVALUATOR, name: "Tone review"}}
    fixture.names = {"u-1": "Alex Kim", "u-2": "Sam Lee", "u-3": "Robin Park"}
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the Configuration tab", () => {
    it("General shows the name, description and type with no Save button", async () => {
        await render()
        expect(host.textContent).toContain("Support replies")
        expect(host.querySelector("pre[data-language=markdown]")?.textContent).toBe(
            "Rate each **reply**.",
        )
        expect(host.textContent).toContain("Traces")
        expect(host.querySelector("input, textarea")).toBeNull()
        expect(button(host, "Save")).toBeUndefined()
        expect(host.textContent).toContain("Number of reviews per run")
    })

    it("In beta developer mode an editor sees the name and description as fields", async () => {
        setBeta(true)
        await render()
        expect((host.querySelector("input") as HTMLInputElement | null)?.value).toBe(
            "Support replies",
        )
        expect(host.querySelector("textarea")?.value).toBe("Rate each **reply**.")
        expect(host.querySelector("pre[data-language=markdown]")).toBeNull()
        // Nothing changed yet, so there is nothing to save.
        expect(button(host, "Save")).toBeUndefined()
    })

    it("In beta developer mode a user without edit rights reads the name and description", async () => {
        setBeta(true)
        await render(false)
        expect(host.querySelector("input, textarea")).toBeNull()
        expect(host.textContent).toContain("Support replies")
    })

    it("An evaluator card switches between Details and JSON", async () => {
        await render()
        expect(host.textContent).toContain("Tone review")
        expect(host.textContent).toContain("V3")
        expect(host.textContent).toContain("Output metrics")
        expect(host.textContent).toContain("friendly: boolean")
        await act(async () => button(host, "JSON")!.click())
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
        const json = host.querySelector("pre[data-language=json]")
        expect(JSON.parse(json?.textContent ?? "{}").slug).toBe("tone-review")
        expect(host.textContent).not.toContain("Output metrics")
    })

    it("A human evaluator shows the Human badge", async () => {
        await render()
        expect(host.textContent).toContain("Human")
        fixture.evaluators = {"ev-1": {data: {...HUMAN_EVALUATOR, flags: {}}, name: "Tone review"}}
        await render()
        expect(host.textContent).not.toContain("Human")
    })

    it("Three assignees show two chips and +1", async () => {
        await render()
        expect(host.textContent).toContain("Alex Kim")
        expect(host.textContent).toContain("Sam Lee")
        expect(host.textContent).not.toContain("Robin Park")
        expect(host.textContent).toContain("+1")
    })

    it("Delete queue is hidden without edit rights", async () => {
        await render(false)
        expect(host.textContent).not.toContain("Delete queue")
    })

    it("Deleting the queue returns to the queue list", async () => {
        await render()
        expect(host.textContent).toContain(
            "Permanently remove this annotation queue and return to the queue list.",
        )
        await act(async () => button(host, "Delete queue")!.click())
        const confirm = button(document.body, "Delete")
        expect(confirm).toBeDefined()
        await act(async () => confirm!.click())
        expect(fixture.deleteQueue).toHaveBeenCalledWith("queue-1")
        expect(fixture.push).toHaveBeenCalledWith("/w/ws-1/p/proj-1/annotations")
    })

    it("No evaluators reads No evaluators configured for this queue.", async () => {
        resetSession({evaluatorIds: [], evaluatorRevisionIds: []})
        fixture.queue = {id: "queue-1", name: "Support replies", data: {}}
        await render()
        expect(host.textContent).toContain("No evaluators configured for this queue.")
        // No description, no type, no assignees: each reads as a dash.
        expect(host.textContent?.match(/—/g)?.length).toBe(3)
    })
})
