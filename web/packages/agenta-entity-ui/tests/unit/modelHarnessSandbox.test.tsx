/**
 * #7290: the Sandbox select offered "Inprocess" for harnesses that cannot run on it.
 *
 * The inprocess sandbox runs only pi_core. The sandbox select must hide it for other
 * harnesses (keeping it listed when it is the saved value), and picking a model whose
 * harness is not pi_core must move sandbox.kind off inprocess in the same change.
 */

import {act, useState, type ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {
    activeUserIdAtom,
    inprocessSandboxEnabledAtom,
    openAgentConfigSectionAtom,
} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    environments: ["local", "daytona", "inprocess"],
    pickHarness: "claude",
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
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                serverConfiguration: () => atom(() => fixture.committed),
            },
        },
        workflowAgentTemplateOverlayAtomFamily: () => atom(() => fixture.overlay),
        harnessCapabilitiesAtomFamily: () => atom(null),
        harnessCatalogFailedAtom: atom(false),
    }
})
vi.mock("../../src/DrillInView/SchemaControls/TriggerManagementSection", () => ({
    useAgentTriggers: () => ({count: 0}),
}))
vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/AgentSecretsSection", () => ({
    AgentSecretsSection: () => <div data-testid="custom-secrets" />,
}))
vi.mock("../../src/DrillInView/components/MoleculeDrillInContext", async (original) => ({
    ...(await original<object>()),
    useOptionalDrillIn: () => (fixture.revision ? {entityId: fixture.revision} : null),
}))
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
                onSelect({
                    modelId: "claude-sonnet-4-5",
                    provider: "anthropic",
                    mode: "agenta",
                    slug: null,
                    harness: fixture.pickHarness,
                })
            }
        >
            Pick model
        </button>
    ),
}))

import {AgentTemplateControl} from "../../src/DrillInView/SchemaControls/AgentTemplateControl"

const schema = (environments = ["local", "daytona", "inprocess"]): SchemaProperty => ({
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
const saved = (kind = "pi_core", sandboxKind = "local") => ({
    llm: {model: "gpt-4o", provider: "openai"},
    harness: {kind, permissions: {allow: ["Read"]}},
    runner: {permissions: {default: "ask"}},
    sandbox: {kind: sandboxKind, permissions: {network: "off"}},
})

let root: Root
let host: HTMLDivElement
let store: ReturnType<typeof createStore>
let live: Record<string, unknown>
const writes = vi.fn()

async function mount(
    value: Record<string, unknown> = saved(),
    options: {environments?: string[]} = {},
) {
    function Host() {
        const [config, setConfig] = useState<Record<string, unknown>>(value)
        live = config
        return (
            <AgentTemplateControl
                schema={schema(options.environments)}
                value={config}
                onChange={(next) => {
                    writes(next)
                    setConfig(next)
                }}
            />
        )
    }
    await act(async () =>
        root.render(
            <Provider store={store}>
                <Host />
            </Provider>,
        ),
    )
}
async function click(element: Element | null | undefined) {
    expect(element).toBeTruthy()
    await act(async () => (element as HTMLElement).click())
}
const button = (text: string, scope: ParentNode = document) =>
    [...scope.querySelectorAll("button")].find((node) => node.textContent === text)

async function sandboxChoices() {
    await click(button("Advanced"))
    await click(button("Execution"))
    const trigger = document.querySelector('[role="dialog"] [role="combobox"]')!
    await act(async () =>
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
    )
    return [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)
}
const setPreference = (on: boolean) => {
    store.set(activeUserIdAtom, "u1")
    store.set(inprocessSandboxEnabledAtom, on)
}
async function pickModelInDrawer() {
    await act(async () => store.set(openAgentConfigSectionAtom, "model-harness"))
    const drawer = document.querySelector('[role="dialog"]')!
    await click(button("Pick model", drawer))
    await click(button("Save", drawer))
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    fixture.environments = ["local", "daytona", "inprocess"]
    fixture.pickHarness = "claude"
    fixture.committed = null
    fixture.overlay = null
    fixture.revision = null
    fixture.saveSection = null
    writes.mockClear()
    store = createStore()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("sandbox options follow the harness (#7290)", () => {
    it("keeps Inprocess listed for the pi_core harness", async () => {
        setPreference(true)
        await mount(saved("pi_core", "inprocess"))
        expect(await sandboxChoices()).toEqual(["Local", "Daytona", "Inprocess"])
        expect(writes).not.toHaveBeenCalled()
    })

    it("hides Inprocess for the claude harness", async () => {
        setPreference(true)
        await mount(saved("claude"))
        expect(await sandboxChoices()).toEqual(["Local", "Daytona"])
        expect(writes).not.toHaveBeenCalled()
    })

    it("hides Inprocess for the codex harness", async () => {
        setPreference(true)
        await mount(saved("codex"))
        expect(await sandboxChoices()).toEqual(["Local", "Daytona"])
        expect(writes).not.toHaveBeenCalled()
    })

    it("keeps a saved Inprocess value listed for an incompatible harness", async () => {
        // The display rule: an already-saved choice stays visible to its owner, so the
        // normalize effect never rewrites it behind their back.
        await mount(saved("claude", "inprocess"))
        expect(writes).not.toHaveBeenCalled()
        expect((live.sandbox as {kind: string}).kind).toBe("inprocess")
        expect(await sandboxChoices()).toEqual(["Local", "Daytona", "Inprocess"])
    })
})

describe("picker selection keeps the config runnable (#7290)", () => {
    it("moves the sandbox off Inprocess in the same change as a Claude pick", async () => {
        setPreference(true)
        await mount(saved("pi_core", "inprocess"))
        await pickModelInDrawer()
        // One committed change carries the model, the harness AND the sandbox move.
        expect(writes).toHaveBeenCalledTimes(1)
        expect(live.llm).toMatchObject({model: "claude-sonnet-4-5", provider: "anthropic"})
        expect((live.harness as {kind: string}).kind).toBe("claude")
        expect((live.sandbox as {kind: string}).kind).toBe("local")
    })

    it("leaves the sandbox alone when the picked harness is pi_core", async () => {
        setPreference(true)
        fixture.pickHarness = "pi_core"
        await mount(saved("pi_core", "inprocess"))
        await pickModelInDrawer()
        expect((live.sandbox as {kind: string}).kind).toBe("inprocess")
    })

    it("leaves the saved value untouched when no compatible sandbox exists", async () => {
        // Only inprocess is enabled: there is nowhere valid to move, so the pick must not
        // rewrite the saved value (same contract as the normalize effect).
        fixture.environments = ["inprocess"]
        setPreference(true)
        await mount(saved("pi_core", "inprocess"), {environments: ["inprocess"]})
        await pickModelInDrawer()
        expect((live.harness as {kind: string}).kind).toBe("claude")
        expect((live.sandbox as {kind: string}).kind).toBe("inprocess")
    })
})
