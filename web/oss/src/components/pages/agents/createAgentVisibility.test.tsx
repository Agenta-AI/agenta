/**
 * /w has no sharing controls, so every agent it creates must stay visible to the whole project.
 * The agents page and the create-app dropdown both mint an ephemeral agent and open the
 * workflow revision drawer, whose Create control is this app's `CommitVariantChangesButton`.
 * These tests follow each entry point to the create call and check its visibility.
 */
import {act, createElement, type ReactNode} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
// The dropdown's antd popover measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver

const EPHEMERAL_ID = "local-agent-1"

const mocks = vi.hoisted(() => ({
    drawerOpens: [] as {entityId: string; context: string}[],
    createCalls: [] as Record<string, unknown>[],
    createEphemeralAppFromTemplate: vi.fn(),
}))

vi.mock("@agenta/entities/workflow", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    // One stable atom per selector: a new atom on every render makes jotai re-render forever.
    const always = (value: unknown) => {
        const valueAtom = jotaiAtom(value)
        return () => valueAtom
    }
    return {
        appTemplatesQueryAtom: jotaiAtom(null),
        createEphemeralAppFromTemplate: mocks.createEphemeralAppFromTemplate,
        workflowMolecule: {
            selectors: {
                data: always({name: "New agent"}),
                isDirty: always(false),
                isEphemeral: always(true),
                isEvaluator: always(false),
                isApplication: always(true),
            },
            get: {data: () => null},
        },
        createWorkflowFromEphemeralAtom: jotaiAtom(
            null,
            async (_get, _set, params: Record<string, unknown>) => {
                mocks.createCalls.push(params)
                return {success: true, newRevisionId: "revision-1"}
            },
        ),
    }
})

vi.mock("@agenta/playground-ui/workflow-revision-drawer", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {
        openWorkflowRevisionDrawerAtom: jotaiAtom(
            null,
            (_get, _set, payload: {entityId: string; context: string}) => {
                mocks.drawerOpens.push(payload)
            },
        ),
    }
})

vi.mock("@agenta/entities/runnable", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {publishMutationAtom: jotaiAtom({mutateAsync: vi.fn()})}
})

vi.mock("@agenta/playground", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {
        playgroundController: {
            actions: {
                commitRevision: jotaiAtom(null, () => ({success: false})),
                createVariant: jotaiAtom(null, () => ({success: false})),
            },
        },
    }
})

// The commit modal's own UI is not under test: a stub that submits the create form when open.
vi.mock("@agenta/entity-ui/modals", () => ({
    EntityCommitModal: ({
        open,
        onSubmit,
    }: {
        open: boolean
        onSubmit: (params: Record<string, unknown>) => Promise<unknown>
    }) =>
        open
            ? createElement(
                  "button",
                  {
                      "data-testid": "commit-submit",
                      onClick: () => void onSubmit({message: "", entityName: "My agent"}),
                  },
                  "Submit",
              )
            : null,
}))

// This app's caches and onboarding, which the host adapter touches after a commit.
vi.mock("@/oss/components/Evaluators/store/evaluatorsPaginatedStore", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {
        clearEvaluatorWorkflowCache: vi.fn(),
        evaluatorsPaginatedStore: {actions: {refresh: jotaiAtom(null, () => undefined)}},
    }
})
vi.mock("@/oss/components/VariantsComponents/store/registryStore", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {
        clearRegistryVariantNameCache: vi.fn(),
        registryPaginatedStore: {actions: {refresh: jotaiAtom(null, () => undefined)}},
    }
})
vi.mock("@/oss/lib/onboarding", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {recordWidgetEventAtom: jotaiAtom(null, () => undefined)}
})
vi.mock("@/oss/state/app", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {selectedAppIdAtom: jotaiAtom(null)}
})

// The agents page's own surroundings.
vi.mock("next/router", () => ({useRouter: () => ({push: vi.fn()})}))
vi.mock("next/link", () => ({
    default: ({children}: {children: ReactNode}) => createElement("a", null, children),
}))
vi.mock("@/oss/hooks/useURL", () => ({default: () => ({baseAppURL: "/apps", projectURL: "/p"})}))
vi.mock("@/oss/hooks/usePlaygroundNavigation", () => ({
    usePlaygroundNavigation: () => ({goToPlayground: vi.fn()}),
}))
vi.mock("@/oss/components/NewAgentButton", () => ({default: () => null}))
vi.mock("./AgentsGrid", () => ({
    default: ({onCreate}: {onCreate: () => void}) =>
        createElement("button", {"data-testid": "agents-grid-create", onClick: onCreate}),
}))
vi.mock("./store", async () => {
    const {atom: jotaiAtom} = await import("jotai")
    return {
        agentsSearchTermAtom: jotaiAtom(""),
        agentsWorkflowsAtom: jotaiAtom([]),
        agentsWorkflowsLoadingAtom: jotaiAtom(false),
        refetchAgentsWorkflowsAtom: jotaiAtom(null, () => undefined),
    }
})
vi.mock("../app-management/modals/DeleteAppModal/store/deleteAppModalStore", () => ({
    openDeleteAppModalAtom: atom(null, () => undefined),
}))
vi.mock("../app-management/modals/EditAppModal/store/editAppModalStore", () => ({
    openEditAppModalAtom: atom(null, () => undefined),
}))

import CreateAppDropdown from "@/oss/components/pages/app-management/components/CreateAppDropdown"
import CommitVariantChangesButton from "@/oss/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"

import AgentsPage from "./AgentsPage"

let store: ReturnType<typeof createStore>
let root: Root | null = null
let host: HTMLDivElement | null = null

const render = (node: ReactNode) => {
    act(() => {
        root?.render(createElement(Provider, {store}, node))
    })
}

const click = async (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector)
    expect(element).not.toBeNull()
    await act(async () => {
        element?.click()
    })
}

/** The drawer the entry point opened, committed through its Create control. */
const createFromOpenedDrawer = async () => {
    expect(mocks.drawerOpens).toEqual([{entityId: EPHEMERAL_ID, context: "app-create"}])
    render(createElement(CommitVariantChangesButton, {variantId: EPHEMERAL_ID, label: "Commit"}))
    await click("button")
    await click('[data-testid="commit-submit"]')
    expect(mocks.createCalls).toHaveLength(1)
    return mocks.createCalls[0]
}

describe("/w agent creation visibility", () => {
    beforeEach(() => {
        store = createStore()
        mocks.drawerOpens.length = 0
        mocks.createCalls.length = 0
        mocks.createEphemeralAppFromTemplate.mockReset()
        mocks.createEphemeralAppFromTemplate.mockResolvedValue(EPHEMERAL_ID)
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root?.unmount())
        host?.remove()
        root = null
        host = null
        document.body.innerHTML = ""
    })

    it("the agents page creates the agent with project visibility", async () => {
        render(createElement(AgentsPage))
        await click('[data-testid="agents-grid-create"]')
        expect(mocks.createEphemeralAppFromTemplate).toHaveBeenCalledWith({type: "agent"})

        const params = await createFromOpenedDrawer()
        expect(params).toEqual(
            expect.objectContaining({revisionId: EPHEMERAL_ID, visibility: "project"}),
        )
    })

    it("the create-app dropdown creates the agent with project visibility", async () => {
        render(createElement(CreateAppDropdown))
        await click('[data-testid="create-app-dropdown-trigger"]')
        await click('[data-testid="create-app-dropdown-agent"]')
        expect(mocks.createEphemeralAppFromTemplate).toHaveBeenCalledWith(
            expect.objectContaining({type: "agent"}),
        )

        const params = await createFromOpenedDrawer()
        expect(params).toEqual(
            expect.objectContaining({revisionId: EPHEMERAL_ID, visibility: "project"}),
        )
    })
})
