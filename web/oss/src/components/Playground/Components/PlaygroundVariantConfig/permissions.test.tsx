import {act} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {preloadAgentTemplateControl} from "@agenta/entity-ui"
import {queryClient} from "@agenta/shared/api"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {RouterContext} from "next/dist/shared/lib/router-context.shared-runtime"
import type {NextRouter} from "next/router"
import {createRoot} from "react-dom/client"
import {afterEach, expect, it, vi} from "vitest"

import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import {appStateSnapshotAtom} from "@/oss/state/appState"
import {parseRouterState} from "@/oss/state/appState/parse"

const fixture = vi.hoisted(() => ({environments: ["local"] as string[], write: vi.fn()}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    getEnabledSandboxProviders: () => fixture.environments,
}))
vi.mock("@agenta/entities/secret", async (original) => {
    const {atom} = await import("jotai")
    return {
        ...(await original<object>()),
        customSecretsAtom: atom([]),
        standardSecretsAtom: atom([]),
        vaultSecretsQueryAtom: atom({data: []}),
        useVaultSecret: () => ({namedSecrets: [], loading: false}),
    }
})
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    const actual = await original<typeof import("@agenta/entities/workflow")>()
    const configuration = atom({
        agent: {
            llm: {model: "gpt-4o", provider: "openai"},
            harness: {kind: "claude", permissions: {deny: ["Write"]}},
            runner: {permissions: {default: "ask", rules: [{tool: "restricted", policy: "deny"}]}},
            sandbox: {kind: "local", permissions: {network: "off"}},
        },
    })
    const data = atom((get) => ({
        id: "revision",
        flags: {is_agent: true},
        data: {parameters: get(configuration)},
    }))
    const empty = atom(null)
    const no = atom(false)
    const schema = atom({
        type: "object",
        properties: {
            agent: {
                type: "object",
                "x-ag-type": "agent-template",
                properties: {
                    llm: {type: "object"},
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
                                    default: {
                                        type: "string",
                                        enum: ["allow", "allow_reads", "ask", "deny"],
                                    },
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
            },
        },
    })
    const query = atom({isPending: false, isError: false, error: null})
    const presets = atom([])
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            atoms: {...actual.workflowMolecule.atoms, draft: () => empty},
            selectors: {
                ...actual.workflowMolecule.selectors,
                data: () => data,
                resolvedData: () => data,
                serverData: () => data,
                configuration: () => configuration,
                serverConfiguration: () => configuration,
                parametersSchema: () => schema,
                query: () => query,
                isEvaluator: () => no,
                isDirty: () => no,
                artifactName: () => empty,
                variantLabel: () => empty,
            },
            actions: {
                ...actual.workflowMolecule.actions,
                updateConfiguration: atom(
                    null,
                    (_get, set, id: string, value: typeof configuration.init) => {
                        fixture.write(id, value)
                        set(configuration, value)
                    },
                ),
            },
        },
        evaluatorPresetsAtomFamily: () => presets,
        workflowAgentTemplateOverlayAtomFamily: () => empty,
        harnessCapabilitiesAtomFamily: () => empty,
        harnessCatalogFailedAtom: no,
    }
})
vi.mock("@/oss/state/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        playgroundEarlyAgentStateAtom: atom("agent"),
        currentWorkflowContextAtom: atom({}),
    }
})
vi.mock("@/oss/components/AgentChatSlice/state/scope", () => ({useChatScopeKey: () => "test"}))
vi.mock("@/oss/components/Drives/useChatScopeSessionId", () => ({
    useChatScopeSessionId: () => null,
}))
vi.mock("@/oss/hooks/useLLMProviderConfig", () => ({
    useLLMProviderConfig: () => ({llmProviderConfig: undefined, overlay: null}),
}))
vi.mock("@/oss/hooks/useURL", () => ({
    default: () => ({baseAppURL: "/w/workspace/p/project/apps"}),
}))

import PlaygroundVariantConfig from "."

afterEach(() => vi.unstubAllGlobals())

it.each([{environments: []}, {environments: ["local"]}, {environments: ["local", "daytona"]}])(
    "desktop host renders shared permissions with environments $environments",
    async ({environments}) => {
        fixture.environments = environments
        fixture.write.mockClear()
        Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
        Element.prototype.scrollIntoView = vi.fn()
        Element.prototype.hasPointerCapture = () => false
        // Keep idle-gated queries deferred; jsdom's fallback timer would fetch mid-test.
        vi.stubGlobal(
            "requestIdleCallback",
            vi.fn(() => 1),
        )
        vi.stubGlobal("cancelIdleCallback", vi.fn())
        const store = createStore()
        const router: NextRouter = {
            basePath: "",
            route: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
            pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
            asPath: "/w/workspace/p/project/apps/agent/playground",
            query: {workspace_id: "workspace", project_id: "project", app_id: "agent"},
            isReady: true,
            isFallback: false,
            isPreview: false,
            isLocaleDomain: false,
            push: vi.fn(async () => true),
            replace: vi.fn(async () => true),
            reload: vi.fn(),
            back: vi.fn(),
            forward: vi.fn(),
            prefetch: vi.fn(async () => undefined),
            beforePopState: vi.fn(),
            events: {on: vi.fn(), off: vi.fn(), emit: vi.fn()},
        }
        store.set(appStateSnapshotAtom, parseRouterState(router))
        store.set(projectIdAtom, "project")
        // Serve cached permission inputs without enabling authenticated queries.
        store.set(sessionAtom, false)
        const user = {id: "user", username: "test-user", email: "test@example.com"}
        const org = {id: "workspace", owner_id: user.id, default_workspace: {id: "workspace"}}
        queryClient.setQueryData(["profile"], user)
        queryClient.setQueryData(["orgs", user.id], [org])
        queryClient.setQueryData(["selectedOrg", org.id], org)
        queryClient.setQueryData(
            ["projects", org.id],
            [{project_id: "project", workspace_id: "workspace", organization_id: org.id}],
        )
        queryClient.setQueryData(
            ["workflows", "runtime", "subscription-status", "claude", "project"],
            {runner: "unavailable"},
        )
        const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected fetch"))
        const xhr = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {
            throw new Error("Unexpected XMLHttpRequest")
        })
        const queryDefaults = queryClient.getDefaultOptions()
        queryClient.setDefaultOptions({
            ...queryDefaults,
            queries: {...queryDefaults.queries, enabled: false},
        })
        store.set(queryClientAtom, queryClient)
        const host = document.createElement("div")
        document.body.append(host)
        const root = createRoot(host)
        try {
            await preloadAgentTemplateControl()
            await act(async () =>
                root.render(
                    <Provider store={store}>
                        <QueryClientProvider client={queryClient}>
                            <RouterContext.Provider value={router}>
                                <OSSdrillInUIProvider>
                                    <PlaygroundVariantConfig variantId="revision" />
                                </OSSdrillInUIProvider>
                            </RouterContext.Provider>
                        </QueryClientProvider>
                    </Provider>,
                ),
            )
            expect(
                host.querySelector('[aria-label="Policy"]'),
                host.textContent ?? "",
            ).not.toBeNull()
            expect(host.textContent).toContain("Permissions")
            expect(host.querySelector('[aria-label="Policy"]')?.textContent).toContain("Ask")
            expect(fixture.write).not.toHaveBeenCalled()
            expect(host.textContent).not.toMatch(
                /Network|Filesystem|Enforcement|Allow rules|Deny rules/,
            )
            expect(host.textContent).toContain("Advanced")
            const advanced = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(
                (node) => node.textContent?.includes("Advanced"),
            )!
            await act(async () => advanced.click())
            expect(document.body.textContent?.includes("Execution environment")).toBe(
                environments.length > 1,
            )
            expect(document.body.textContent).toContain("Custom secrets")
            expect(document.querySelector('[role="dialog"] [aria-label="Policy"]')).toBeNull()
            expect(document.body.textContent).not.toMatch(
                /Network|Filesystem|Enforcement|Allow rules|Deny rules/,
            )
            await act(async () =>
                [...document.querySelectorAll("button")]
                    .find((node) => node.textContent === "Cancel")!
                    .click(),
            )
            const before = store.get(workflowMolecule.selectors.configuration("revision"))
            await act(async () =>
                host
                    .querySelector('[aria-label="Policy"]')!
                    .dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
            )
            await act(async () =>
                (
                    [...document.querySelectorAll('[role="option"]')].find((node) =>
                        node.textContent?.startsWith("Allow all"),
                    ) as HTMLElement
                ).click(),
            )
            expect(fixture.write).toHaveBeenCalledWith("revision", {
                ...before,
                agent: {
                    ...(before!.agent as object),
                    runner: {
                        permissions: {
                            default: "allow",
                            rules: [{tool: "restricted", policy: "deny"}],
                        },
                    },
                },
            })
            expect(fetch).not.toHaveBeenCalled()
            expect(xhr).not.toHaveBeenCalled()
        } finally {
            await act(async () => root.unmount())
            host.remove()
            queryClient.clear()
            queryClient.setDefaultOptions(queryDefaults)
            fetch.mockRestore()
            xhr.mockRestore()
        }
    },
)
