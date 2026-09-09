// @vitest-environment jsdom
import {act, useState} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {preloadAgentTemplateControl, SchemaPropertyRenderer} from "@agenta/entity-ui/drill-in"
import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {DrillInBridgeProvider} from "@/features/chat/DrillInBridgeProvider"
import {queryClient} from "@/lib/queryClient"

const fixture = vi.hoisted(() => ({environments: ["local"]}))
const projectId = "permissions-test-project"
const sessionId = "permissions-test-session"

// v0.115.4's DrillInBridgeProvider reads the workspace id off the router to build the "Open agent"
// href. This suite renders the provider outside a Next app, so stand in the fields it reads.
vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => ({query: {}, basePath: "", asPath: "/"}),
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    getEnabledSandboxProviders: () => fixture.environments,
}))
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    const capabilities = atom(null)
    return {
        ...(await original<object>()),
        harnessCapabilitiesAtomFamily: () => capabilities,
        harnessCatalogFailedAtom: atom(false),
    }
})

const schema: SchemaProperty = {
    type: "object",
    "x-ag-type": "agent-template",
    properties: {
        harness: {
            type: "object",
            properties: {kind: {type: "string"}, permissions: {type: "object"}},
        },
        runner: {
            type: "object",
            properties: {
                permissions: {
                    type: "object",
                    properties: {
                        default: {type: "string", enum: ["allow", "allow_reads", "ask", "deny"]},
                    },
                },
            },
        },
        sandbox: {
            type: "object",
            properties: {
                kind: {type: "string", enum: ["local", "daytona"]},
                permissions: {type: "object"},
            },
        },
    },
}
const saved = {
    harness: {kind: "claude", permissions: {deny: ["Write"], default_mode: "plan"}},
    runner: {permissions: {default: "ask", rules: [{tool: "dangerous", policy: "deny"}]}},
    sandbox: {kind: "local", permissions: {network: "off", filesystem: "readonly"}},
}

let root: Root
let host: HTMLDivElement
let store: ReturnType<typeof createStore>
const writes = vi.fn()

async function mount(disabled = false) {
    function ConfigField() {
        const [value, setValue] = useState<unknown>(saved)
        return (
            <SchemaPropertyRenderer
                schema={schema}
                label="Agent"
                value={value}
                disabled={disabled}
                onChange={(next) => {
                    writes(next)
                    setValue(next)
                }}
            />
        )
    }
    await preloadAgentTemplateControl()
    // Keep the real permission hook offline with fresh host-cache data.
    queryClient.setQueryData(["mobile", "project-permission", projectId, "edit_secret"], false)
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>
                    <DrillInBridgeProvider sessionId={sessionId} projectId={projectId}>
                        <ConfigField />
                    </DrillInBridgeProvider>
                </Provider>
            </QueryClientProvider>,
        )
    })
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    fixture.environments = ["local"]
    writes.mockClear()
    store = createStore()
    store.set(queryClientAtom, queryClient)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    queryClient.clear()
})

// FAILING against v0.115.4: its `DrillInBridgeProvider` now reads the workspace id from
// `useRouter()`, and this suite mounts the provider outside a Next app ("NextRouter was not
// mounted"). Mocking `next/router` and mounting `RouterContext` both miss — vitest resolves a
// different module instance than Next's own `useRouter` reads — so the suite needs either a
// router-providing test harness or the provider to stop requiring one.
describe("mobile schema-driven agent permissions", () => {
    it.each([{environments: []}, {environments: ["local"]}])(
        "hides empty Advanced for environments $environments",
        async ({environments}) => {
            fixture.environments = environments
            await mount()
            expect(host.querySelector('[aria-label="Policy"]')).not.toBeNull()
            expect(host.textContent).not.toContain("Advanced")
            expect(writes).not.toHaveBeenCalled()
        },
    )

    it("renders and edits the real top-level policy without exposing saved restrictions", async () => {
        await mount()
        expect(host.textContent).toContain("Permissions")
        expect(host.textContent).not.toContain("Advanced")
        const policy = host.querySelector('[aria-label="Policy"]')!
        expect(policy).not.toBeNull()
        await act(async () =>
            policy.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
        )
        const allow = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (option) => option.textContent?.startsWith("Allow all"),
        )!
        expect(allow).toBeDefined()
        await act(async () => allow.click())
        expect(writes).toHaveBeenLastCalledWith({
            ...saved,
            runner: {permissions: {...saved.runner.permissions, default: "allow"}},
        })
    })

    it("passes read-only through the schema renderer to the real policy control", async () => {
        await mount(true)
        const policy = host.querySelector<HTMLButtonElement>('[aria-label="Policy"]')!
        expect(policy.disabled).toBe(true)
        await act(async () => policy.click())
        expect(document.querySelector('[role="option"]')).toBeNull()
        expect(writes).not.toHaveBeenCalled()
    })

    it("keeps permission editors out of the real Advanced drawer", async () => {
        fixture.environments = ["local", "daytona"]
        await mount()
        await act(async () => store.set(openAgentConfigSectionAtom, "advanced"))
        const drawer = document.querySelector('[role="dialog"]')!
        expect(drawer).not.toBeNull()
        expect(drawer.textContent).toContain("Execution environment")
        expect(drawer.querySelector('[aria-label="Policy"]')).toBeNull()
        expect(drawer.textContent).not.toMatch(
            /Network|Filesystem|Enforcement|Allow rules|Deny rules/,
        )
        expect(writes).not.toHaveBeenCalled()
    })
})
