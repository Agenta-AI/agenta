/**
 * A view that the configuration control opens in its own drawer (a host with no view stack, such
 * as the Configuration page) reads the same editor facts as the host: whether the agent answers
 * in a channel (hasChannel) comes from the host's editor.
 */
import {act, useContext, useState, type ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    environments: ["local", "daytona"],
    committed: null as Record<string, unknown> | null,
    overlay: null as Record<string, unknown> | null,
    revision: null as string | null,
    saveSection: null as (() => void) | null,
}))

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
    }
})
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    const actual = await original<typeof import("@agenta/entities/workflow")>()
    const committed = atom(() => fixture.committed)
    const overlay = atom(() => fixture.overlay)
    const capabilities = atom(null)
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {...actual.workflowMolecule.selectors, serverConfiguration: () => committed},
        },
        workflowAgentTemplateOverlayAtomFamily: () => overlay,
        harnessCapabilitiesAtomFamily: () => capabilities,
        harnessCatalogFailedAtom: atom(false),
    }
})
vi.mock("../../src/DrillInView/SchemaControls/TriggerManagementSection", () => ({
    useAgentTriggers: () => ({count: 0}),
}))
vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/AgentSecretsSection", () => ({
    AgentSecretsSection: ({localDraftDirty}: {localDraftDirty?: boolean}) => (
        <div data-testid="custom-secrets" data-draft-dirty={String(localDraftDirty)} />
    ),
}))
vi.mock("../../src/DrillInView/components/MoleculeDrillInContext", async (original) => ({
    ...(await original<object>()),
    useOptionalDrillIn: () => (fixture.revision ? {entityId: fixture.revision} : null),
}))
// Keep drawer lifecycle and section composition real; replace only portal/animation chrome.
vi.mock("../../src/DrillInView/SchemaControls/SectionDrawer", () => ({
    SectionDrawer: ({
        open,
        title,
        children,
        onSave,
        onCancel,
        disabled,
    }: {
        open: boolean
        title: ReactNode
        children: ReactNode
        onSave: () => void
        onCancel: () => void
        disabled: boolean
    }) => {
        if (open) fixture.saveSection = onSave
        return open ? (
            <div role="dialog" aria-label={String(title)}>
                {children}
                <button onClick={onCancel}>Cancel</button>
                <button onClick={onSave} disabled={disabled}>
                    Save
                </button>
            </div>
        ) : null
    },
}))
vi.mock("@agenta/ui/components/presentational", async (original) => ({
    ...(await original<object>()),
    ConfigAccordionSection: ({
        title,
        children,
        onOpen,
        defaultOpen,
        extra,
    }: {
        title: ReactNode
        children: ReactNode
        onOpen?: () => void
        defaultOpen?: boolean
        extra?: ReactNode
    }) => {
        const [open, setOpen] = useState(defaultOpen)
        return (
            <section aria-label={String(title)}>
                <button onClick={() => (onOpen ? onOpen() : setOpen(!open))}>{title}</button>
                {extra}
                {!onOpen && open ? children : null}
            </section>
        )
    },
}))
vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/ModelPickerControl", () => ({
    default: ({onSelect}: {onSelect: (selection: object) => void}) => (
        <button
            onClick={() =>
                onSelect({modelId: "gpt-5", provider: "openai", mode: "agenta", harness: "pi_core"})
            }
        >
            Pick model
        </button>
    ),
}))

// The drawer is the opener's; this probe stands in for the view inside it.
vi.mock("@agenta/ui/view-stack", async (original) => {
    const actual = await original<typeof import("@agenta/ui/view-stack")>()
    const {AgentEditorContext} =
        await import("../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter")
    function DrawerProbe() {
        const editor = useContext(AgentEditorContext)
        return <div data-testid="drawer-view" data-has-channel={String(editor?.hasChannel)} />
    }
    return {...actual, useViewOpener: () => ({open: async () => true, drawer: <DrawerProbe />})}
})

import {AgentEditorContext} from "../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter"
import {AgentTemplateControl} from "../../src/DrillInView/SchemaControls/AgentTemplateControl"

const schema = (environments = ["local", "daytona"]): SchemaProperty => ({
    type: "object",
    properties: {
        llm: {type: "object"},
        harness: {
            type: "object",
            properties: {
                kind: {type: "string", enum: ["pi_core", "claude", "codex"]},
                permissions: {type: "object"},
            },
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
            properties: {kind: {type: "string", enum: environments}, permissions: {type: "object"}},
        },
    },
})
const saved = (kind = "pi_core") => ({
    llm: {model: "gpt-4o", provider: "openai"},
    harness: {
        kind,
        permissions: {allow: ["Read"], ask: ["Bash"], deny: ["Write"], default_mode: "plan"},
    },
    runner: {permissions: {default: "ask", rules: [{tool: "dangerous", policy: "deny"}]}},
    sandbox: {
        kind: "local",
        permissions: {network: "off", filesystem: "readonly", enforcement: "strict"},
    },
})

let root: Root
let host: HTMLDivElement

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    fixture.environments = ["local", "daytona"]
    fixture.committed = null
    fixture.overlay = null
    fixture.revision = "rev-4"
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const mount = (hasChannel: boolean | undefined) =>
    act(async () =>
        root.render(
            <Provider store={createStore()}>
                <AgentEditorContext.Provider
                    value={{revisionId: "rev-4", readOnly: false, hasChannel}}
                >
                    <AgentTemplateControl schema={schema()} value={saved()} onChange={() => {}} />
                </AgentEditorContext.Provider>
            </Provider>,
        ),
    )

const drawerHasChannel = () =>
    document.querySelector<HTMLElement>('[data-testid="drawer-view"]')?.dataset.hasChannel

describe("a view in the control's drawer", () => {
    it("sees hasChannel from the host's editor", async () => {
        await mount(true)
        expect(drawerHasChannel()).toBe("true")
        await mount(false)
        expect(drawerHasChannel()).toBe("false")
    })

    it("leaves it unknown when the host does not know", async () => {
        await mount(undefined)
        expect(drawerHasChannel()).toBe("undefined")
    })
})
