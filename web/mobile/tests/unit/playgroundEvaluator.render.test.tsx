// @vitest-environment jsdom
/**
 * The evaluator playground on the real playground controllers and the real workflow queries.
 * Only HTTP is mocked: the workflow endpoints answer from the fixtures below, and `fetch` stands
 * in for the services that run the app and the evaluator. The config editor, the app list and
 * the nav are stubs: the app picker hands back one app revision when clicked.
 */
import {act} from "react"

import {playgroundController} from "@agenta/playground"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {useTokenPathSuggestions} from "@agenta/ui/editor"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundScreen} from "@/features/playground/PlaygroundScreen"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluators/playground",
        query: {} as Record<string, string>,
        basePath: "/m",
        replace: vi.fn(),
        push: vi.fn(),
        events: {on: vi.fn(), off: vi.fn()},
    },
}))

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
vi.mock("@agenta/playground-ui/panels/evaluator", async (original) => ({
    ...(await original<object>()),
    AppPicker: ({onSelect}: {onSelect: (app: {id: string; label: string}) => void}) => (
        <button type="button" onClick={() => onSelect({id: "app-rev-1", label: "Support bot"})}>
            Pick app
        </button>
    ),
}))
/** What the prompt editor's `{{$.inputs.` and `{{$.outputs.` typeahead would offer. */
const Suggestions = () => {
    const getSuggestions = useTokenPathSuggestions()
    if (!getSuggestions) return null
    const labels = (slot: string) => getSuggestions([slot], "").map((item) => item.label)
    return (
        <output data-testid="token-paths">
            {JSON.stringify({inputs: labels("inputs"), outputs: labels("outputs")})}
        </output>
    )
}
vi.mock("@agenta/playground-ui/panels/config", () => ({
    ConfigPanel: ({revisionId, actions}: {revisionId: string; actions?: React.ReactNode}) => (
        <div data-testid="config-panel">
            {revisionId}
            {actions}
            <Suggestions />
        </div>
    ),
    ConfigPanelSkeleton: () => null,
    RevisionSwitcher: () => null,
}))
// The commit dialog is not under test: "Commit" reports the revision a commit made.
vi.mock("@/features/playground/RevisionActions", () => ({
    RevisionActions: ({onCommitted}: {onCommitted: (revisionId: string) => void}) => (
        <button type="button" onClick={() => onCommitted("eval-rev-2")}>
            Commit
        </button>
    ),
}))
vi.mock("@/features/playground/PlaygroundTestsetMenu", () => ({
    PlaygroundTestsetMenu: () => null,
}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@agenta/ui/editor", async (original) => ({
    ...(await original<object>()),
    preloadEditorPlugins: vi.fn(),
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/PageNotFound", () => ({
    PageNotFound: () => <div data-testid="not-found" />,
}))

// One project for every test: the revision batch fetcher refuses a batch that spans projects.
const projectId = "proj-1"
const evaluatorRevision = {
    id: "eval-rev-1",
    version: 2,
    name: "default",
    workflow_id: "eval-1",
    workflow_variant_id: "eval-1-variant",
    flags: {is_evaluator: true},
    created_at: "2026-11-01T00:00:00Z",
    data: {
        uri: "agenta:builtin:auto_exact_match:v0",
        parameters: {correct_answer_key: "correct_answer"},
        // The expected answer is required: a test case without it skips the evaluator.
        schemas: {
            inputs: {
                type: "object",
                properties: {correct_answer: {type: "string"}},
                required: ["correct_answer"],
            },
        },
    },
}
const committedEvaluatorRevision = {...evaluatorRevision, id: "eval-rev-2", version: 3}
const appRevision = {
    id: "app-rev-1",
    version: 3,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: "app-1-variant",
    flags: {is_application: true},
    created_at: "2026-11-01T00:00:00Z",
    data: {
        uri: "agenta:builtin:completion:v0",
        parameters: {
            prompt: {
                messages: [{role: "user", content: "What is the capital of {{country}}?"}],
                llm_config: {model: "gpt-4o-mini"},
            },
        },
    },
}
http.post.mockImplementation(async (url: string, body: unknown) => {
    const sent = JSON.stringify(body ?? {})
    if (url.endsWith("/workflows/query")) {
        return {
            data: {
                count: 2,
                workflows: [
                    {id: "eval-1", name: "Exact match", flags: {is_evaluator: true}},
                    {id: "app-1", name: "Support bot", flags: {}},
                ],
            },
        }
    }
    if (url.endsWith("/workflows/revisions/query")) {
        const revisions = [evaluatorRevision, committedEvaluatorRevision, appRevision].filter(
            (revision) => sent.includes(revision.id),
        )
        return {data: {count: revisions.length, workflow_revisions: revisions}}
    }
    return {data: {}}
})
http.get.mockImplementation(async (url: string) =>
    url.includes("/evaluators/catalog/templates/auto_exact_match/presets/")
        ? {
              data: {
                  count: 1,
                  presets: [
                      {
                          key: "strict",
                          name: "Strict match",
                          data: {parameters: {correct_answer_key: "expected_answer"}},
                      },
                  ],
              },
          }
        : {data: {}},
)

/** What the services receive. */
const calls: {url: string; body: Record<string, unknown>; signal?: AbortSignal | null}[] = []
/** When set, the app's request waits for this promise before it answers. */
let appGate: Promise<void> | null = null

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}
// The popovers render outside the host, so buttons are looked up in the whole document. A
// name matches the text, the aria label, or the start of the text (a list option has a
// description after its name).
const button = (label: string) => {
    const all = [...document.querySelectorAll<HTMLButtonElement>("button")]
    return (
        all.find(
            (item) => item.textContent === label || item.getAttribute("aria-label") === label,
        ) ?? all.find((item) => item.textContent?.startsWith(label))
    )
}
const click = async (label: string) => {
    const target = button(label)
    expect(target, `a button named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
const typeInto = async (variable: string, value: string) => {
    const field = host.querySelector<HTMLTextAreaElement>(
        `[data-testid="input-variable-${variable}"] textarea`,
    )!
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
            field,
            value,
        )
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const graph = () =>
    store
        .get(playgroundController.selectors.nodes())
        .map(({entityId, depth}) => `${entityId}@${depth}`)

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, revisions: "eval-rev-1"}
    router.replace.mockReset()
    router.replace.mockResolvedValue(true)
    calls.length = 0
    appGate = null
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        calls.push({url: String(url), body: JSON.parse(String(init.body)), signal: init.signal})
        if (appGate && String(url).includes("completion")) await appGate
        const answer = String(url).includes("auto_exact_match")
            ? {data: {outputs: {score: 1, success: true}}, trace_id: "trace-2"}
            : {data: "Paris", trace_id: "trace-1"}
        return new Response(JSON.stringify(answer), {status: 200})
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() =>
        root.render(<PlaygroundScreen mode="evaluator" workspaceId="ws-1" projectId={projectId} />),
    )
    await settle()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

describe("The evaluator playground", () => {
    it("Opens the evaluator alone and asks for an app to run on", () => {
        expect(host.querySelector("h1")?.textContent).toBe("Exact match")
        expect(host.textContent).toContain("Run on:App output")
        expect(host.textContent).toContain("Select an app to run the evaluator on")
        expect(graph()).toEqual(["eval-rev-1@0"])
    })

    it("Picking an app puts it before the evaluator and shows its test cases", async () => {
        await click("Pick app")

        expect(graph()).toEqual(["app-rev-1@0", "eval-rev-1@1"])
        expect(host.textContent).not.toContain("Select an app to run the evaluator on")
        expect(host.querySelector('[data-testid="input-variable-country"]')).not.toBeNull()
        // The config pane keeps the evaluator, and the address keeps naming it.
        expect(host.querySelector('[data-testid="config-panel"]')?.textContent).toMatch(
            /^eval-rev-1/,
        )
        expect(router.replace).not.toHaveBeenCalled()
    })

    it("The evaluator's prompt typeahead offers the app's inputs and outputs only when chained", async () => {
        expect(host.querySelector('[data-testid="token-paths"]')).toBeNull()

        await click("Pick app")

        expect(JSON.parse(host.querySelector('[data-testid="token-paths"]')!.textContent!)).toEqual(
            // The app declares no outputs: `$.outputs` is the whole output, with no field to offer.
            {inputs: ["country"], outputs: []},
        )
    })

    it("Run one step runs the app alone, then the evaluator alone once the app has an output", async () => {
        await click("Pick app")
        await typeInto("country", "France")
        await typeInto("correct_answer", "Paris")
        const openSteps = async () => {
            await act(async () => {
                button("Run one step")!.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
            })
            await settle()
            return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        }

        let steps = await openSteps()
        expect(steps.map((item) => item.textContent)).toEqual([
            "Run Support bot",
            "Run Exact match",
        ])
        // The evaluator grades the app's output: none yet.
        expect(steps[1].hasAttribute("data-disabled")).toBe(true)
        await act(async () => steps[0].click())
        await settle()
        expect(calls.map((call) => call.url)).toEqual([
            "http://localhost:3000/services/completion/v0/invoke?project_id=proj-1",
        ])

        steps = await openSteps()
        expect(steps[1].hasAttribute("data-disabled")).toBe(false)
        await act(async () => steps[1].click())
        await settle()
        expect(calls.map((call) => call.url)).toEqual([
            "http://localhost:3000/services/completion/v0/invoke?project_id=proj-1",
            "http://localhost:3000/services/auto_exact_match/v0/invoke?project_id=proj-1",
        ])
    })

    it("Disconnect app leaves the evaluator alone again", async () => {
        await click("Pick app")

        await click("Disconnect app")

        expect(graph()).toEqual(["eval-rev-1@0"])
        expect(host.textContent).toContain("Select an app to run the evaluator on")
    })

    it("Run on a test case drops the app and runs the evaluator directly", async () => {
        await click("Pick app")

        await click("Run on:App output")
        await click("Run directly on a test case")

        expect(graph()).toEqual(["eval-rev-1@0"])
        expect(host.textContent).toContain("Run on:Test case")
        expect(host.querySelector('[data-testid^="completion-row-"]')).not.toBeNull()
    })

    it("Run on an app runs the app, then the evaluator on its output", async () => {
        await click("Pick app")
        await typeInto("country", "France")
        await typeInto("correct_answer", "Paris")
        await click("Run")

        expect(calls.map((call) => call.url)).toEqual([
            "http://localhost:3000/services/completion/v0/invoke?project_id=proj-1",
            "http://localhost:3000/services/auto_exact_match/v0/invoke?project_id=proj-1",
        ])
        const [app, evaluator] = calls.map((call) => call.body)
        expect((app.data as Record<string, unknown>).inputs).toEqual({country: "France"})
        expect(app.references).toEqual({
            application: {id: "app-1"},
            application_variant: {id: "app-1-variant"},
            application_revision: {id: "app-rev-1", version: "3"},
        })
        expect(evaluator).toEqual({
            interface: {uri: "agenta:builtin:auto_exact_match:v0"},
            data: {
                inputs: {correct_answer: "Paris", country: "France"},
                outputs: "Paris",
                parameters: {correct_answer_key: "correct_answer"},
            },
            references: {
                evaluator: {id: "eval-1"},
                evaluator_variant: {id: "eval-1-variant"},
                evaluator_revision: {id: "eval-rev-1", version: "2"},
            },
        })
        // The app's output, then the evaluator's score card under it.
        const card = host.querySelector('[data-testid="evaluator-score-eval-rev-1"]')!
        expect(host.textContent).toContain("Paris")
        expect(card.textContent).toBe("Exact matchScore:1Success:true")
    })

    it("A commit of the evaluator keeps the app first, and the address follows", async () => {
        await click("Pick app")

        await click("Commit")

        expect(graph()).toEqual(["app-rev-1@0", "eval-rev-2@1"])
        expect(host.querySelector('[data-testid="config-panel"]')?.textContent).toContain(
            "eval-rev-2",
        )
        expect(router.replace).toHaveBeenLastCalledWith(
            expect.objectContaining({query: expect.objectContaining({revisions: "eval-rev-2"})}),
            undefined,
            {shallow: true},
        )
    })

    it("Load Preset puts the preset's settings in the evaluator's draft", async () => {
        const {workflowMolecule} = await import("@agenta/entities/workflow")

        await click("Load Preset")
        const footer = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
            (item) => item.textContent === "Load Preset",
        )
        await act(async () => footer[footer.length - 1].click())
        await settle()

        expect(store.get(workflowMolecule.selectors.isDirty("eval-rev-1"))).toBe(true)
        expect(store.get(workflowMolecule.selectors.configuration("eval-rev-1"))).toEqual({
            correct_answer_key: "expected_answer",
        })
    })

    it("Cancel stops the app's request, and its late answer changes nothing", async () => {
        let release: () => void = () => undefined
        appGate = new Promise<void>((resolve) => {
            release = resolve
        })
        await click("Pick app")
        await click("Run")
        expect(calls).toHaveLength(1)

        await click("Cancel")
        expect(calls[0].signal?.aborted).toBe(true)
        release()
        await settle()

        // The evaluator never ran, and the run shows no answer.
        expect(calls).toHaveLength(1)
        expect(host.textContent).not.toContain("Paris")
        expect(button("Run")).toBeDefined()
    })

    it("A skipped evaluator says why", async () => {
        await click("Pick app")
        await typeInto("country", "France")

        await click("Run")

        // Only the app ran: the test case has no expected answer.
        expect(calls).toHaveLength(1)
        const card = host.querySelector('[data-testid="evaluator-score-eval-rev-1"]')!
        expect(card.textContent).toContain("correct_answer")
    })

    it("Leaving the page clears the chain", async () => {
        await click("Pick app")

        act(() => root.unmount())
        root = createRoot(host)

        expect(graph()).toEqual([])
    })
})
