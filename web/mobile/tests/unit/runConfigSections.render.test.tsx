// @vitest-environment jsdom
import {act, createElement} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({query: {} as Record<string, string>, replace: vi.fn()}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        replace: router.replace,
    }),
}))

// The test set data is read only: the atoms are the seam, the values are the fixture.
vi.mock("@agenta/entities/testset", async () => {
    const {atom: makeAtom} = await import("jotai")
    // One atom per id: a new atom on every render would never settle.
    const once = <T,>(make: (id: string) => T) => {
        const cache = new Map<string, T>()
        return (id: string) => {
            if (!cache.has(id)) cache.set(id, make(id))
            return cache.get(id) as T
        }
    }
    return {
        testsetQueryAtomFamily: once((id) =>
            makeAtom({
                data: {id, name: `Set ${id}`, description: id === "ts-1" ? "Capital cities" : ""},
                isPending: false,
            }),
        ),
        revisionMolecule: {
            query: once(() =>
                makeAtom({data: {data: {testcase_ids: ["a", "b", "c"]}}, isPending: false}),
            ),
            atoms: {
                enableWithTestcases: makeAtom(null, () => undefined),
                withTestcasesQueryResult: once((id) =>
                    makeAtom({
                        data: null,
                        isPending: id === "rev-slow",
                        isError: id === "rev-error",
                    }),
                ),
                testcaseColumns: once((id) =>
                    makeAtom(
                        id === "rev-empty" || id === "rev-slow" || id === "rev-error"
                            ? []
                            : ["country", "capital"],
                    ),
                ),
            },
        },
    }
})
// The prompt view carries the editors; the test reads which revision it shows.
vi.mock("@agenta/entity-ui/variant", () => ({
    RevisionConfigView: ({revisionId}: {revisionId: string}) =>
        createElement("div", {"data-testid": "prompt-template"}, revisionId),
}))
// The editor is a separate chunk; the test reads the value it would show.
vi.mock("@/features/evaluation-run/configuration/ConfigJsonViewer", () => ({
    ConfigJsonViewer: ({value}: {value: unknown}) =>
        createElement("pre", {"data-testid": "json"}, JSON.stringify(value)),
}))

import {ApplicationConfigSection} from "@/features/evaluation-run/configuration/ApplicationConfigSection"
import {TestsetConfigSection} from "@/features/evaluation-run/configuration/TestsetConfigSection"
import type {ApplicationConfig} from "@/features/evaluation-run/configuration/useApplicationConfig"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

const store = createStore()
let client = new QueryClient()

async function render(node: ReturnType<typeof createElement>) {
    await act(async () => {
        root.render(
            createElement(Provider, {store}, createElement(QueryClientProvider, {client}, node)),
        )
    })
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
}

const APPLICATION: ApplicationConfig = {
    applicationId: "app-1",
    appName: "Capital finder",
    appFailed: false,
    variantName: "default",
    version: 3,
    revisionId: "rev-app",
    snapshot: {parameters: {temperature: 0.2}},
    configFailed: false,
    customWithoutSchema: false,
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    router.query = {workspace_id: "ws", project_id: "pr", evaluation_id: "run-1"}
    router.replace.mockReset()
    client = new QueryClient()
    vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "testsets,variants")
    store.set(activeUserIdAtom, "user-1")
})

afterEach(() => {
    vi.unstubAllEnvs()
    act(() => root.unmount())
    host.remove()
})

describe("test set section", () => {
    it("Test set rows show the count, the columns and the description", async () => {
        await render(
            createElement(TestsetConfigSection, {
                projectId: "pr",
                testsets: [{testsetId: "ts-1", revisionId: "rev-1", version: 3}],
            }),
        )
        const chip = [...host.querySelectorAll("a")].find((link) =>
            link.textContent?.includes("Set ts-1"),
        )
        expect(chip?.getAttribute("href")).toBe("/w/ws/p/pr/testsets/rev-1")
        expect(chip?.textContent).toContain("3")
        const text = host.textContent ?? ""
        expect(text).toContain("Test set")
        expect(text).toContain("Set ts-1")
        expect(text).toContain("Test cases")
        expect(host.querySelector("dl")?.textContent).toContain("3")
        expect(text).toContain("country")
        expect(text).toContain("capital")
        expect(text).toContain("Capital cities")
    })

    it("A test set without columns says there is no column metadata", async () => {
        await render(
            createElement(TestsetConfigSection, {
                projectId: "pr",
                testsets: [{testsetId: "ts-2", revisionId: "rev-empty", version: null}],
            }),
        )
        expect(host.textContent).toContain("No column metadata.")
        expect(host.textContent).not.toContain("Description")
    })

    it("A slow test case read shows a loading state, not No column metadata", async () => {
        await render(
            createElement(TestsetConfigSection, {
                projectId: "pr",
                testsets: [{testsetId: "ts-2", revisionId: "rev-slow", version: null}],
            }),
        )
        expect(host.textContent).not.toContain("No column metadata.")
        expect(
            host.querySelector('[aria-busy="true"], [data-slot="skeleton"], .animate-pulse'),
        ).not.toBeNull()
    })

    it("A failed test case read says so and Try again reads it again", async () => {
        const invalidate = vi.spyOn(client, "invalidateQueries")
        await render(
            createElement(TestsetConfigSection, {
                projectId: "pr",
                testsets: [{testsetId: "ts-2", revisionId: "rev-error", version: null}],
            }),
        )
        expect(host.textContent).not.toContain("No column metadata.")
        expect(host.textContent).toContain("Could not load the columns.")
        const retry = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Try again",
        )
        await act(async () => retry?.click())
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: ["revision-with-testcases", "pr", "rev-error"],
        })
    })

    it("A run without a test set shows no Test set section", async () => {
        await render(createElement(TestsetConfigSection, {projectId: "pr", testsets: []}))
        expect(host.textContent).toBe("")
    })

    it("Two test sets show their count in the subtitle", async () => {
        await render(
            createElement(TestsetConfigSection, {
                projectId: "pr",
                testsets: [
                    {testsetId: "ts-1", revisionId: "rev-1", version: null},
                    {testsetId: "ts-2", revisionId: "rev-2", version: null},
                ],
            }),
        )
        expect(host.textContent).toContain("2 test sets")
    })
})

describe("application section", () => {
    it("Shows the app, the variant with its version and the type", async () => {
        await render(createElement(ApplicationConfigSection, {application: APPLICATION}))
        const text = host.textContent ?? ""
        expect(text).toContain("Capital finder")
        expect(text).toContain("default")
        expect(text).toContain("v3")
        expect(text).toContain("Workflow")
    })

    it("The variant links to the variants page with the run's revision open", async () => {
        await render(createElement(ApplicationConfigSection, {application: APPLICATION}))
        const variant = [...host.querySelectorAll("a")].find((link) =>
            link.textContent?.includes("default"),
        )
        expect(variant?.getAttribute("href")).toBe(
            "/w/ws/p/pr/variants?app=app-1&revisionId=rev-app",
        )
    })

    it("Shows the prompt template of the revision the run used", async () => {
        await render(createElement(ApplicationConfigSection, {application: APPLICATION}))
        expect(host.textContent).toContain("Prompt Template")
        expect(host.querySelector('[data-testid="prompt-template"]')?.textContent).toBe("rev-app")
    })

    it("A custom workflow shows the JSON snapshot and the no schema note", async () => {
        await render(
            createElement(ApplicationConfigSection, {
                application: {...APPLICATION, customWithoutSchema: true},
            }),
        )
        await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
        expect(host.textContent).toContain("Custom workflow")
        expect(host.textContent).toContain("No playground schema")
        expect(host.querySelector('[data-testid="json"]')).not.toBeNull()
        expect(host.querySelector('[data-testid="prompt-template"]')).toBeNull()
    })

    it("A custom workflow opens its JSON when the data arrives after a cold load", async () => {
        await render(
            createElement(ApplicationConfigSection, {
                application: {...APPLICATION, snapshot: null, customWithoutSchema: false},
            }),
        )
        expect(host.querySelector('[data-testid="json"]')).toBeNull()
        await render(
            createElement(ApplicationConfigSection, {
                application: {...APPLICATION, customWithoutSchema: true},
            }),
        )
        await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
        expect(host.querySelector('[data-testid="json"]')).not.toBeNull()
    })

    it("A missing app says the metadata is unavailable", async () => {
        await render(
            createElement(ApplicationConfigSection, {
                application: {...APPLICATION, appName: null, appFailed: true},
            }),
        )
        expect(host.textContent).toContain("Application metadata unavailable.")
    })

    it("A missing revision says the configuration is unavailable", async () => {
        await render(
            createElement(ApplicationConfigSection, {
                application: {...APPLICATION, snapshot: null, configFailed: true},
            }),
        )
        expect(host.textContent).toContain("Variant configuration unavailable.")
        expect(host.textContent).toContain("Capital finder")
    })
})
