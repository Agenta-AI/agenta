import {act, useState, type ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    environments: ["local", "daytona"],
    committed: null as Record<string, unknown> | null,
    overlay: null as Record<string, unknown> | null,
    revision: null as string | null,
    opened: [] as string[],
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
vi.mock("../../src/DrillInView/components/MoleculeDrillInContext", async (original) => ({
    ...(await original<object>()),
    useOptionalDrillIn: () => (fixture.revision ? {entityId: fixture.revision} : null),
}))
// Advanced and the Model open views; the views have their own tests.
vi.mock("@agenta/ui/view-stack", async (original) => ({
    ...(await original<object>()),
    useViewOpener: () => ({
        open: async (view: {id: string}) => {
            fixture.opened.push(view.id)
            return true
        },
        drawer: null,
    }),
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
let store: ReturnType<typeof createStore>
let live: Record<string, unknown>
let update: (next: Record<string, unknown>) => void
const writes = vi.fn()

async function mount(
    value: Record<string, unknown> = saved(),
    options: {disabled?: boolean; environments?: string[]} = {},
) {
    function Host() {
        const [config, setConfig] = useState<Record<string, unknown>>(value)
        live = config
        update = setConfig
        return (
            <AgentTemplateControl
                schema={schema(options.environments)}
                value={config}
                disabled={options.disabled}
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
async function choose(trigger: Element | null, text: string) {
    expect(trigger).toBeTruthy()
    await act(async () =>
        trigger!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
    )
    await click(
        [...document.querySelectorAll('[role="option"]')].find((node) =>
            node.textContent?.startsWith(text),
        ),
    )
}
function expectRules(value = saved()) {
    expect((live.harness as Record<string, unknown>).permissions).toEqual(value.harness.permissions)
    expect((live.runner as typeof value.runner).permissions.rules).toEqual(
        value.runner.permissions.rules,
    )
    expect((live.sandbox as Record<string, unknown>).permissions).toEqual(value.sandbox.permissions)
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    fixture.environments = ["local", "daytona"]
    fixture.committed = null
    fixture.overlay = null
    fixture.revision = null
    fixture.opened = []
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

describe("shared agent settings", () => {
    it.each(["pi_core", "claude", "codex"])(
        "shows only the shared policy for %s, outside Advanced",
        async (kind) => {
            await mount(saved(kind))
            // Permissions starts closed (canvas S02); its row opens the policy inline.
            await click(button("Permissions"))
            const permissions = host.querySelector('section[aria-label="Permissions"]')!
            expect(permissions.querySelector('[aria-label="Policy"]')).not.toBeNull()
            const advanced = host.querySelector('section[aria-label="Advanced"]')!
            expect(advanced.querySelector('[aria-label="Policy"]')).toBeNull()
            await choose(permissions.querySelector('[aria-label="Policy"]'), "Allow all")
            expect((live.runner as ReturnType<typeof saved>["runner"]).permissions.default).toBe(
                "allow",
            )
            expectRules(saved(kind))
        },
    )

    it.each([{environments: []}, {environments: ["local"]}, {environments: ["local", "unknown"]}])(
        "hides Advanced with filtered environments $environments",
        async ({environments}) => {
            fixture.environments = environments
            await mount()
            expect(button("Advanced")).toBeUndefined()
            expect(button("Permissions")).toBeDefined()
            expect(writes).not.toHaveBeenCalled()
        },
    )

    it("opens the Advanced view from its row, and on a remote request", async () => {
        fixture.revision = "saved-revision"
        await mount()
        await click(button("Advanced"))
        await act(async () => store.set(openAgentConfigSectionAtom, "advanced"))
        expect(fixture.opened).toEqual(["agent.advanced", "agent.advanced"])
        expect(writes).not.toHaveBeenCalled()
    })

    it("shows Secrets as its own section after Skills, and not in Advanced", async () => {
        fixture.revision = "saved-revision"
        await mount()
        const titles = [...host.querySelectorAll("section")].map((s) =>
            s.getAttribute("aria-label"),
        )
        expect(titles).toContain("Secrets")
        expect(titles.indexOf("Secrets")).toBeLessThan(titles.indexOf("Permissions"))
        expect(button("Custom secrets")).toBeUndefined()
    })

    it("does not normalize an invalid sandbox on a disabled surface", async () => {
        await mount({...saved(), sandbox: {...saved().sandbox, kind: "removed"}}, {disabled: true})
        expect(writes).not.toHaveBeenCalled()
        expect((live.sandbox as {kind: string}).kind).toBe("removed")
    })

    it("offers no Restore action for a disabled dirty policy", async () => {
        fixture.committed = saved()
        await mount(
            {...saved(), runner: {permissions: {...saved().runner.permissions, default: "deny"}}},
            {disabled: true},
        )
        await click(button("Permissions"))
        const permissions = host.querySelector('section[aria-label="Permissions"]')!
        expect(
            (permissions.querySelector('[aria-label="Policy"]') as HTMLButtonElement).disabled,
        ).toBe(true)
        // The policy select runs full width with no rail label, so there is no change marker to open.
        expect(button("Policy", permissions)).toBeUndefined()
        expect(button("Restore")).toBeUndefined()
        expect(writes).not.toHaveBeenCalled()
    })

    it("normalizes only once through the live owner and preserves sandbox rules", async () => {
        await mount({...saved(), sandbox: {...saved().sandbox, kind: "removed"}})
        expect(writes).toHaveBeenCalledTimes(1)
        expect((live.sandbox as {kind: string}).kind).toBe("local")
        expectRules()
    })

    it("leaves a dirty policy and hidden rules alone, with no inline Restore", async () => {
        fixture.committed = saved()
        const dirty = {
            ...saved(),
            runner: {permissions: {default: "allow", rules: [{tool: "new", policy: "deny"}]}},
            harness: {
                ...saved().harness,
                permissions: {...saved().harness.permissions, deny: ["Edit"]},
            },
        }
        await mount(dirty)
        const permissions = host.querySelector('section[aria-label="Permissions"]')!
        // The Policy row no longer carries a change marker, so nothing reverts the policy inline.
        expect(button("Policy", permissions)).toBeUndefined()
        expect(button("Restore", permissions)).toBeUndefined()
        expect((live.runner as typeof dirty.runner).permissions.default).toBe("allow")
        expectRules(dirty)
    })

    it("focuses only sandbox.kind inline and its Restore leaves hidden rules dirty", async () => {
        fixture.committed = saved()
        const dirty = {
            ...saved(),
            sandbox: {
                kind: "daytona",
                permissions: {network: "on", filesystem: "read_write", enforcement: "strict"},
            },
        }
        await mount(dirty)
        await click(button("Advanced"))
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        const advanced = host.querySelector('section[aria-label="Advanced"]')!
        expect(advanced.querySelector('[role="combobox"]')).not.toBeNull()
        expect(advanced.textContent).not.toMatch(/Network|Filesystem|Enforcement|Policy/)
        await click(button("Sandbox", advanced))
        await click(button("Restore"))
        expect((live.sandbox as {kind: string}).kind).toBe("local")
        expectRules(dirty)
    })
})
