import {act, useState, type ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {workflowBuildKitEnabledAtomFamily} from "@agenta/entities/workflow"
import {openAgentConfigSectionAtom} from "@agenta/shared/state"
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

describe("shared agent settings", () => {
    it("Restore and Save preserve restrictions added after a pruned sandbox snapshot", async () => {
        const {sandbox: _sandbox, ...committed} = saved()
        fixture.committed = committed
        await mount({...committed, sandbox: {kind: "local"}})
        await act(async () => store.set(openAgentConfigSectionAtom, "advanced"))
        const drawer = document.querySelector('[role="dialog"][aria-label="Advanced"]')!
        // Name the field: the panel header carries a group-revert popover trigger too.
        await click(button("Sandbox", drawer))
        await click(button("Remove change"))
        await act(async () =>
            update({...committed, sandbox: {kind: "local", permissions: {network: "off"}}}),
        )
        await click(button("Save", drawer))
        expect(writes.mock.calls[0]?.[0].sandbox).toEqual({permissions: {network: "off"}})
        expect((live.sandbox as {permissions: unknown}).permissions).toEqual({network: "off"})
    })

    it("saves the complete buffered Pi model selection over a newer Claude selection", async () => {
        await mount()
        await act(async () => store.set(openAgentConfigSectionAtom, "model-harness"))
        const drawer = document.querySelector('[role="dialog"]')!
        await click(button("Pick model", drawer))
        const newer = {
            ...saved("claude"),
            llm: {
                model: "sonnet",
                provider: "anthropic",
                connection: {mode: "self_managed"},
                extras: {seed: 2},
            },
            harness: {kind: "claude", permissions: {deny: ["new restriction"]}},
        }
        await act(async () => update(newer))
        await click(button("Save", drawer))
        expect(live.llm).toEqual({model: "gpt-5", provider: "openai", extras: {seed: 2}})
        expect(live.harness).toEqual({kind: "pi_core", permissions: newer.harness.permissions})
        expect(live.runner).toEqual(newer.runner)
        expect(live.sandbox).toEqual(newer.sandbox)
    })

    it.each(["model-harness", "advanced"] as const)(
        "discards %s drafts on revision changes and rejects stale Save callbacks",
        async (section) => {
            fixture.revision = "old-revision"
            await mount()
            await act(async () => store.set(openAgentConfigSectionAtom, section))
            if (section === "model-harness")
                await click(button("Pick model", document.querySelector('[role="dialog"]')!))
            else {
                await click(button("Execution"))
                await choose(document.querySelector('[role="dialog"] [role="combobox"]'), "Daytona")
            }
            const staleSave = fixture.saveSection!
            const newer = {...saved("claude"), llm: {model: "sonnet", provider: "anthropic"}}
            await act(async () => {
                fixture.revision = "new-revision"
                update(newer)
            })
            expect(document.querySelector('[role="dialog"]')).toBeNull()
            await act(async () => staleSave())
            expect(writes).not.toHaveBeenCalled()
            expect(live).toEqual(newer)
        },
    )
    it.each(["pi_core", "claude", "codex"])(
        "shows only the shared policy for %s, outside Advanced",
        async (kind) => {
            await mount(saved(kind))
            const permissions = host.querySelector('section[aria-label="Permissions"]')!
            expect(permissions.querySelector('[aria-label="Policy"]')).not.toBeNull()
            await click(button("Advanced"))
            await click(button("Execution"))
            const drawer = document.querySelector('[role="dialog"]')!
            expect(drawer.querySelector('[aria-label="Policy"]')).toBeNull()
            expect(drawer.textContent).not.toMatch(
                /Network|Filesystem|Enforcement|harness|Permission|Allow rules|Deny rules/,
            )
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

    it("keeps build-kit availability but hides its sandbox policy and hint", async () => {
        fixture.environments = ["local"]
        fixture.overlay = {
            tools: [{type: "platform", op: "commit_revision"}],
            sandbox: {permissions: {network: "on"}},
        }
        const overlay = structuredClone(fixture.overlay)
        await mount()
        await click(button("Advanced"))
        await click(button("Build kit"))
        expect(
            document.querySelector('[aria-label="Enable the playground build kit"]'),
        ).not.toBeNull()
        expect(document.querySelector('[aria-label="Save changes"]')).not.toBeNull()
        expect(button("Execution")).toBeUndefined()
        expect(document.body.textContent).not.toMatch(/Sandbox permissions|Build kit overrides/)
        expect(fixture.overlay).toEqual(overlay)
        expect(writes).not.toHaveBeenCalled()
    })

    it("keeps Custom secrets without a build kit or environment choice", async () => {
        fixture.environments = ["local"]
        fixture.revision = "saved-revision"
        await mount()
        await click(button("Advanced"))
        expect(button("Execution")).toBeUndefined()
        // One panel needs no nav, so Custom secrets is simply what the drawer opens on.
        expect(button("Custom secrets")).toBeUndefined()
        expect(document.querySelector('[data-testid="custom-secrets"]')).not.toBeNull()
        expect(document.querySelector('[role="dialog"] [aria-label="Policy"]')).toBeNull()
        expect(writes).not.toHaveBeenCalled()
    })

    it("blocks credential operations while the Advanced section is dirty", async () => {
        fixture.revision = "saved-revision"
        await mount()
        await click(button("Advanced"))
        await click(button("Custom secrets"))
        const secrets = () => document.querySelector('[data-testid="custom-secrets"]')!
        expect(secrets().getAttribute("data-draft-dirty")).toBe("false")
        await click(button("Execution"))
        await choose(document.querySelector('[role="dialog"] [role="combobox"]'), "Daytona")
        // The rail mounts one panel at a time, so go back to the panel being asserted on.
        await click(button("Custom secrets"))
        expect(secrets().getAttribute("data-draft-dirty")).toBe("true")
        expect(writes).not.toHaveBeenCalled()
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
        const permissions = host.querySelector('section[aria-label="Permissions"]')!
        expect(
            (permissions.querySelector('[aria-label="Policy"]') as HTMLButtonElement).disabled,
        ).toBe(true)
        await click(permissions.querySelector('[aria-haspopup="dialog"]'))
        expect(button("Restore")).toBeUndefined()
        expect(writes).not.toHaveBeenCalled()
    })

    it("normalizes only once through the live owner and preserves sandbox rules", async () => {
        await mount({...saved(), sandbox: {...saved().sandbox, kind: "removed"}})
        expect(writes).toHaveBeenCalledTimes(1)
        expect((live.sandbox as {kind: string}).kind).toBe("local")
        expectRules()
    })

    it("saves a stale Model drawer without overwriting newer policy or hidden rules", async () => {
        await mount()
        await act(async () => store.set(openAgentConfigSectionAtom, "model-harness"))
        await click(button("Pick model", document.querySelector('[role="dialog"]')!))
        const newer = {
            ...saved(),
            runner: {permissions: {default: "deny", rules: [{tool: "new", policy: "ask"}]}},
            sandbox: {...saved().sandbox, permissions: {network: "on"}},
        }
        await act(async () => update(newer))
        await click(button("Save"))
        expect(live.llm).toMatchObject({model: "gpt-5"})
        expect(live.runner).toEqual(newer.runner)
        expect(live.sandbox).toEqual(newer.sandbox)
        expect((live.harness as {permissions: unknown}).permissions).toEqual(
            saved().harness.permissions,
        )
    })

    it("cancels buffered Model edits without reverting newer live policy", async () => {
        await mount()
        await act(async () => store.set(openAgentConfigSectionAtom, "model-harness"))
        await click(button("Pick model", document.querySelector('[role="dialog"]')!))
        const newer = {
            ...saved(),
            runner: {permissions: {...saved().runner.permissions, default: "allow"}},
        }
        await act(async () => update(newer))
        await click(button("Cancel"))
        expect(live).toEqual(newer)
        expect(writes).not.toHaveBeenCalled()
    })

    it("saves and cancels Advanced environment edits without changing stored restrictions", async () => {
        await mount()
        await click(button("Advanced"))
        await click(button("Execution"))
        await choose(document.querySelector('[role="dialog"] [role="combobox"]'), "Daytona")
        expect(live.sandbox).toEqual(saved().sandbox)
        await click(button("Cancel"))
        expect(live).toEqual(saved())
        await click(button("Advanced"))
        await click(button("Execution"))
        await choose(document.querySelector('[role="dialog"] [role="combobox"]'), "Daytona")
        const newer = {
            ...saved(),
            runner: {permissions: {...saved().runner.permissions, default: "deny"}},
        }
        await act(async () => update(newer))
        await click(button("Save"))
        expect((live.sandbox as {kind: string}).kind).toBe("daytona")
        expect(live.runner).toEqual(newer.runner)
        expectRules()
    })

    it("reverts only the visible policy, keeping hidden dirty rules", async () => {
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
        await click(permissions.querySelector('[aria-haspopup="dialog"]'))
        await click(button("Restore"))
        expect((live.runner as typeof dirty.runner).permissions.default).toBe("ask")
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
        await click(advanced.querySelector('[aria-haspopup="dialog"]'))
        await click(button("Restore"))
        expect((live.sandbox as {kind: string}).kind).toBe("local")
        expectRules(dirty)
    })

    it.each(["Save", "Cancel"])(
        "buffers environment group Revert until %s and never reverts sandbox rules",
        async (action) => {
            fixture.committed = saved()
            const dirty = {
                ...saved(),
                sandbox: {
                    ...saved().sandbox,
                    kind: "daytona",
                    permissions: {...saved().sandbox.permissions, network: "on"},
                },
            }
            await mount(dirty)
            await act(async () => store.set(openAgentConfigSectionAtom, "advanced"))
            const drawer = document.querySelector('[role="dialog"][aria-label="Advanced"]')!
            await click(button("Revert", drawer))
            await click(
                button("Revert", document.querySelector('[aria-label="Revert this group?"]')!),
            )
            expect(live).toEqual(dirty)
            await click(button(action, drawer))
            expect((live.sandbox as {kind: string}).kind).toBe(
                action === "Save" ? "local" : "daytona",
            )
            expectRules(dirty)
        },
    )

    it("does not roll back newer build-kit availability when saving only a model", async () => {
        await mount()
        await act(async () => store.set(openAgentConfigSectionAtom, "model-harness"))
        await click(button("Pick model", document.querySelector('[role="dialog"]')!))
        await act(async () => store.set(workflowBuildKitEnabledAtomFamily(""), false))
        await click(button("Save"))
        expect(store.get(workflowBuildKitEnabledAtomFamily(""))).toBe(false)
    })
})
