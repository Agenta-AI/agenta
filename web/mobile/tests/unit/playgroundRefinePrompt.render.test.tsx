// @vitest-environment jsdom
/**
 * Refine prompt (the wand on a prompt section) on the real playground controllers and workflow
 * molecule. Only HTTP is mocked: the `axios` of `@agenta/shared/api` answers from the fixtures
 * below. The tests assert the exact refine request and what reaches the revision's draft.
 */
import {act} from "react"

import {projectPermissionQueryKey} from "@agenta/entities/access"
import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {queryClient as hostQueryClient} from "@agenta/shared/api"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClientProvider, type QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundScreen} from "@/features/playground/PlaygroundScreen"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        basePath: "/m",
        query: {} as Record<string, string>,
        replace: vi.fn(),
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
// The real section shows the wand only when it can edit and the prompt has messages.
vi.mock("@agenta/entity-ui/drill-in", async (original) => ({
    ...(await original<object>()),
    PlaygroundConfigSection: ({
        disabled,
        onRefinePrompt,
    }: {
        disabled?: boolean
        onRefinePrompt?: (promptKey: string) => void
    }) =>
        !disabled && onRefinePrompt ? (
            <button type="button" onClick={() => onRefinePrompt("prompt")}>
                Refine prompt with AI
            </button>
        ) : null,
}))
// The rich message editor is not under test: a text box stands in for it.
vi.mock("@agenta/ui/chat-message", () => ({
    ChatMessageEditor: ({
        role,
        text,
        disabled,
        onChangeText,
    }: {
        role: string
        text: string
        disabled?: boolean
        onChangeText?: (value: string) => void
    }) => (
        <textarea
            aria-label={`Refined ${role} message`}
            value={text}
            disabled={disabled}
            onChange={(event) => onChangeText?.(event.target.value)}
        />
    ),
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({CatalogDrawer: () => null}))
vi.mock("@agenta/ui/editor", async (original) => ({
    ...(await original<object>()),
    preloadEditorPlugins: vi.fn(),
    DiffView: ({original, modified}: {original: string; modified: string}) => (
        <pre data-testid="diff">{`${original}\n---\n${modified}`}</pre>
    ),
}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@/features/playground/PlaygroundHeader", () => ({PlaygroundHeader: () => null}))
vi.mock("@/features/playground/PlaygroundRunPane", () => ({PlaygroundRunPane: () => null}))
vi.mock("@/features/playground/PlaygroundSplit", () => ({
    PlaygroundSplit: ({config}: {config: React.ReactNode}) => <div>{config}</div>,
}))
vi.mock("@/features/playground/usePlaygroundLeaveGuard", () => ({
    usePlaygroundLeaveGuard: () => null,
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/PageNotFound", () => ({PageNotFound: () => <div>not found</div>}))

type Body = Record<string, unknown>

/** The saved prompt: a system message with a name, a user message, and a model. */
const savedPrompt = {
    messages: [
        {role: "system", content: "You answer with a capital.", name: "rules"},
        {role: "user", content: [{type: "text", text: "Capital of {{country}}?"}]},
    ],
    llm_config: {model: "gpt-4o-mini", temperature: 0.2},
    template_format: "curly",
}
const revision = {
    id: "rev-1",
    version: 1,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: "var-1",
    workflow_variant_slug: "capitals.var-1",
    flags: {is_application: true},
    created_at: "2026-11-01T00:00:00Z",
    data: {uri: "agenta:builtin:completion:v0", parameters: {prompt: savedPrompt}},
}

const refinedMessages = [
    {role: "system", content: "Answer with the capital city only."},
    {role: "user", content: "What is the capital of {{country}}?"},
]

/** How the refine tool answers the next call. */
const refineAnswer = {
    mode: "ok" as "ok" | "tool-error" | "http-error",
    hold: null as Promise<void> | null,
}

const answer = (url: string): unknown => {
    if (url.endsWith("/workflows/query")) {
        return {count: 1, workflows: [{id: "app-1", name: "Capitals", slug: "capitals", flags: {}}]}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        return {count: 1, workflow_revisions: [revision]}
    }
    if (url.endsWith("/workflows/variants/query")) {
        return {
            count: 1,
            workflow_variants: [
                {id: "var-1", slug: "capitals.var-1", name: "default", workflow_id: "app-1"},
            ],
        }
    }
    if (url.endsWith("/simple/environments/query")) return {count: 0, environments: []}
    return {}
}

let projectId = "proj-0"
const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let client: QueryClient

const calls: {method: string; url: string; body: Body}[] = []
const refineCalls = () => calls.filter((call) => call.url.endsWith("/ai/services/tools/call"))
/** Requests that change saved data. Refine must never send one. */
const writes = () =>
    calls.filter(
        (call) =>
            call.method !== "get" &&
            /\/(commit|archive)$|\/variants\/$/.test(call.url.replace(/\?.*/, "")),
    )

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.scrollTo = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.releasePointerCapture = () => undefined
    refineAnswer.mode = "ok"
    refineAnswer.hold = null
    client = hostQueryClient
    client.clear()
    store.set(queryClientAtom, client)
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1"}
    router.replace.mockReset()
    router.replace.mockResolvedValue(true)
    calls.length = 0
    http.post.mockImplementation(async (url: string, body: Body) => {
        calls.push({method: "post", url, body})
        if (url.endsWith("/ai/services/tools/call")) {
            if (refineAnswer.hold) await refineAnswer.hold
            if (refineAnswer.mode === "http-error") {
                throw new Error("Request failed with status code 503")
            }
            if (refineAnswer.mode === "tool-error") {
                return {
                    data: {
                        isError: true,
                        content: [{type: "text", text: "Upstream timed out"}],
                    },
                }
            }
            return {
                data: {
                    isError: false,
                    content: [{type: "text", text: "ok"}],
                    structuredContent: {
                        messages: refinedMessages,
                        summary: "Made the system message stricter.",
                    },
                },
            }
        }
        return {data: answer(url)}
    })
    http.get.mockImplementation(async (url: string) => {
        calls.push({method: "get", url, body: {}})
        return {data: {}}
    })
    client.setQueryData(projectPermissionQueryKey(projectId, "edit_workflows"), true)
    client.setQueryData(projectPermissionQueryKey(projectId, "deploy_environments"), true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    store.set(playgroundController.actions.resetAll)
    vi.restoreAllMocks()
})

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}
const shown = () => store.get(playgroundController.selectors.entityIds())
const mount = async () => {
    act(() =>
        root.render(
            <QueryClientProvider client={client}>
                <PlaygroundScreen workspaceId="ws-1" projectId={projectId} appId="app-1" />
            </QueryClientProvider>,
        ),
    )
    await settle()
    for (let i = 0; i < 40 && shown().length === 0; i++) await settle()
}
const label = (el: Element) => el.textContent?.trim() ?? ""
const dialog = () => document.querySelector<HTMLElement>("[role=dialog]")
const find = (name: string) => {
    const scope: ParentNode = dialog() ?? document.body
    return [
        ...scope.querySelectorAll<HTMLElement>(
            "button, [role=button], [role=switch], [role=radio]",
        ),
    ].find((item) => label(item) === name || item.getAttribute("aria-label") === name)
}
const click = async (name: string) => {
    const target = find(name)
    expect(target, `a control named ${name}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
const isDisabled = (name: string) => {
    const target = find(name)
    expect(target, `a control named ${name}`).toBeDefined()
    return target!.hasAttribute("disabled") || target!.getAttribute("aria-disabled") === "true"
}
const typeInstructions = async (value: string) => {
    const box = dialog()?.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="Describe how to refine your prompt…"]',
    )
    expect(box, "the instructions box").toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
    act(() => {
        setter.call(box, value)
        box!.dispatchEvent(new Event("input", {bubbles: true}))
    })
    return box!
}
const openRefine = async () => {
    await mount()
    await click("Refine prompt with AI")
    expect(dialog(), "the refine dialog").toBeTruthy()
}
const refineWith = async (value: string) => {
    await typeInstructions(value)
    await click("Send")
}
const config = () => store.get(workflowMolecule.selectors.configuration("rev-1")) as Body
const prompt = () => config().prompt as typeof savedPrompt
const isDirty = () => store.get(workflowMolecule.selectors.isDirty("rev-1"))
const text = () => dialog()?.textContent ?? ""

describe("Refine prompt", () => {
    it("Refine sends the prompt and the instructions to the refine tool", async () => {
        await openRefine()
        expect(text()).toContain("Describe how you want to refine your prompt")
        expect(text()).toContain("Submit instructions to see the refined prompt")
        expect(isDisabled("Use refined prompt")).toBe(true)
        expect(isDisabled("Toggle diff view")).toBe(true)

        await refineWith("Be shorter")

        expect(refineCalls()).toHaveLength(1)
        const [call] = refineCalls()
        expect(call.url).toMatch(/\/ai\/services\/tools\/call$/)
        expect(call.body).toEqual({
            name: "tools.agenta.api.refine_prompt",
            arguments: {
                // The saved prompt with text-only messages: the content parts join into text.
                prompt_template_json: JSON.stringify({
                    messages: [
                        {role: "system", content: "You answer with a capital."},
                        {role: "user", content: "Capital of {{country}}?"},
                    ],
                    llm_config: {model: "gpt-4o-mini", temperature: 0.2},
                    template_format: "curly",
                }),
                guidelines: "Be shorter",
                context: "",
            },
        })
        expect(text()).toContain("Be shorter")
        expect(text()).toContain("Made the system message stricter.")
        expect(writes()).toHaveLength(0)
    })

    it("Enter sends, Shift+Enter does not, and Cmd+Enter sends from anywhere in the dialog", async () => {
        await openRefine()
        const box = await typeInstructions("Be shorter")
        const press = (target: Element, init: KeyboardEventInit) =>
            act(() => {
                target.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, ...init}))
            })

        press(box, {key: "Enter", shiftKey: true})
        await settle()
        expect(refineCalls()).toHaveLength(0)

        press(box, {key: "Enter"})
        await settle()
        expect(refineCalls()).toHaveLength(1)

        await typeInstructions("Use a friendly tone")
        press(find("Toggle diff view")!, {key: "Enter", metaKey: true})
        await settle()
        expect(refineCalls()).toHaveLength(2)
        expect((refineCalls()[1].body.arguments as Body).guidelines).toBe("Use a friendly tone")

        // Cmd+Enter in the box sends once, not once for the box and once for the dialog.
        press(await typeInstructions("Add an example"), {key: "Enter", metaKey: true})
        await settle()
        expect(refineCalls()).toHaveLength(3)
    })

    it("A second round refines the working copy, not the saved prompt", async () => {
        await openRefine()
        await refineWith("Be shorter")
        await click("Optimize the prompt using best practices")

        expect(refineCalls()).toHaveLength(2)
        const args = refineCalls()[1].body.arguments as Body
        expect(args.guidelines).toBe("Optimize the prompt using best practices")
        expect(JSON.parse(args.prompt_template_json as string).messages).toEqual(refinedMessages)
    })

    it("Shows the wait while the tool works, and blocks a second send", async () => {
        let release: () => void = () => undefined
        refineAnswer.hold = new Promise<void>((resolve) => {
            release = resolve
        })
        await openRefine()
        await refineWith("Be shorter")

        expect(text()).toContain("Refining prompt…")
        expect(isDisabled("Send")).toBe(true)
        expect(isDisabled("Optimize the prompt using best practices")).toBe(true)
        expect(isDisabled("Use refined prompt")).toBe(true)

        await act(async () => release())
        await settle()

        expect(text()).not.toContain("Refining prompt…")
        expect(isDisabled("Use refined prompt")).toBe(false)
        expect(isDisabled("Toggle diff view")).toBe(false)
    })

    it("Use refined prompt writes the messages into the draft and keeps the other fields", async () => {
        await openRefine()
        await refineWith("Be shorter")
        await click("Use refined prompt")

        expect(dialog()).toBeNull()
        expect(isDirty()).toBe(true)
        expect(prompt().llm_config).toEqual(savedPrompt.llm_config)
        expect(prompt().template_format).toBe("curly")
        // Same message count: each message keeps its other fields, such as the name.
        expect(prompt().messages).toEqual([
            {role: "system", content: "Answer with the capital city only.", name: "rules"},
            {role: "user", content: "What is the capital of {{country}}?"},
        ])
        expect(writes()).toHaveLength(0)
    })

    it("Use refined prompt keeps an edit made in the preview", async () => {
        await openRefine()
        await refineWith("Be shorter")
        const box = dialog()!.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Refined user message"]',
        )!
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
        act(() => {
            setter.call(box, "Name the capital of {{country}}.")
            box.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await click("Use refined prompt")

        expect(prompt().messages[1]).toEqual({
            role: "user",
            content: "Name the capital of {{country}}.",
        })
    })

    it("The refined messages cannot be edited while the next round runs", async () => {
        await openRefine()
        await refineWith("Be shorter")
        const editor = () =>
            dialog()!.querySelector<HTMLTextAreaElement>(
                'textarea[aria-label="Refined user message"]',
            )!
        expect(editor().disabled).toBe(false)

        let release: () => void = () => undefined
        refineAnswer.hold = new Promise<void>((resolve) => {
            release = resolve
        })
        await refineWith("Use a friendly tone")
        expect(editor().disabled).toBe(true)

        await act(async () => release())
        await settle()
        expect(editor().disabled).toBe(false)
    })

    it("The diff compares the saved messages with the refined ones", async () => {
        await openRefine()
        await refineWith("Be shorter")
        await click("Toggle diff view")

        const diff = document.querySelector("[data-testid=diff]")?.textContent ?? ""
        expect(diff).toContain("You answer with a capital.")
        expect(diff).toContain("Answer with the capital city only.")
    })

    it("Cancel leaves the draft unchanged", async () => {
        await openRefine()
        await refineWith("Be shorter")
        await click("Cancel")

        expect(dialog()).toBeNull()
        expect(isDirty()).toBe(false)
        expect(prompt().messages).toEqual(savedPrompt.messages)
    })

    it("Closing the dialog drops the refine history", async () => {
        await openRefine()
        await refineWith("Be shorter")
        await click("Close modal")
        await click("Refine prompt with AI")

        expect(text()).toContain("Describe how you want to refine your prompt")
        expect(text()).not.toContain("Be shorter")
        expect(isDisabled("Use refined prompt")).toBe(true)
    })

    it("A failed request shows a plain message, logs the cause, and keeps the draft", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
        refineAnswer.mode = "http-error"
        await openRefine()
        await refineWith("Be shorter")

        expect(text()).toContain("Couldn't refine the prompt. Try again.")
        expect(text()).not.toContain("status code")
        expect(log).toHaveBeenCalled()
        expect(String(log.mock.calls.flat().join(" "))).toContain("status code 503")
        expect(isDisabled("Use refined prompt")).toBe(true)
        expect(isDirty()).toBe(false)
    })

    it("An error from the tool shows the same plain message", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
        refineAnswer.mode = "tool-error"
        await openRefine()
        await refineWith("Be shorter")

        expect(text()).toContain("Couldn't refine the prompt. Try again.")
        expect(text()).not.toContain("Upstream timed out")
        expect(String(log.mock.calls.flat().join(" "))).toContain("Upstream timed out")
        expect(isDisabled("Use refined prompt")).toBe(true)
    })
})
