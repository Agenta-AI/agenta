/**
 * The secrets flow (F04 f3 to f10, F06 f3): "Attach a secret" with its scope tags, the one secret
 * form of Settings, the remove dialog, and the Advanced views (Execution, Agenta tools).
 */
import {act, createElement} from "react"

import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
    type ViewDef,
    type ViewTarget,
} from "@agenta/ui/view-stack"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

const {writer, fx} = vi.hoisted(() => ({
    writer: {
        agent: {} as Record<string, unknown>,
        schema: null as unknown,
        revisionId: "rev-1",
        readOnly: false,
        update: null as unknown as (
            next: (agent: Record<string, unknown>) => Record<string, unknown>,
        ) => void,
    },
    fx: {
        project: [] as Record<string, unknown>[],
        own: [] as Record<string, unknown>[],
        access: "on" as string,
        commits: [] as {revisionId: string; bindings: unknown[]}[],
        commitError: null as string | null,
        choices: [] as unknown[],
        choiceOk: true,
        saved: [] as Record<string, unknown>[],
        committed: null as Record<string, unknown> | null,
        environments: ["local", "daytona"],
        toolsAccess: {get_current_session: "read", create_schedule: "write"} as Record<
            string,
            string
        >,
        order: [] as string[],
    },
}))

vi.mock(
    "../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter",
    async (original) => ({
        ...(await original<object>()),
        useAgentConfigWriter: () => writer,
    }),
)
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    getEnabledSandboxProviders: () => fx.environments,
}))
vi.mock("@agenta/entities/secret", async (original) => {
    const {atom} = await import("jotai")
    return {
        ...(await original<object>()),
        useVaultSecret: () => ({
            namedSecrets: fx.project,
            loading: false,
            mutate: async () => ({}),
            handleModifyNamedSecret: async (row: Record<string, unknown>) => {
                fx.saved.push(row)
                fx.order.push("vault")
                return "new-secret-id"
            },
        }),
        personalAccountsAccessAtom: atom(() => fx.access),
        personalNamedSecretsAtom: atom(() => fx.own),
    }
})
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    const actual = await original<typeof import("@agenta/entities/workflow")>()
    const clean = atom(false)
    const workflowId = atom("wf-1")
    const committed = atom(() => fx.committed)
    const overlay = atom(null)
    return {
        ...actual,
        commitAgentCredentialsAtom: atom(
            null,
            async (_get, _set, input: {revisionId: string; bindings: unknown[]}) => {
                fx.order.push("commit")
                if (fx.commitError) throw new Error(fx.commitError)
                fx.commits.push(input)
                return {revisionId: "rev-2"}
            },
        ),
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                isDirty: () => clean,
                workflowId: () => workflowId,
                serverConfiguration: () => committed,
            },
        },
        agentaToolsAccessAtom: atom(() => ({isError: false, data: fx.toolsAccess})),
        workflowAgentTemplateOverlayAtomFamily: () => overlay,
    }
})
vi.mock("../../src/accounts/useAccountChoice", () => ({
    useAccountChoice: () => ({
        choose: async (pick: unknown) => {
            fx.order.push("choice")
            fx.choices.push(pick)
            return fx.choiceOk
        },
        busy: false,
        failed: false,
    }),
}))
vi.mock("../../src/accounts/useItemAccount", () => ({
    useItemAccount: () => ({workflowId: "wf-1", account: undefined, loading: false, failed: false}),
}))
vi.mock("../../src/accounts/useProjectName", () => ({useProjectName: () => "Acme Agency"}))
vi.mock("@agenta/ui/drill-in", async (original) => ({
    ...(await original<object>()),
    useDrillInUI: () => ({permissions: {canEditSecrets: true}}),
}))

import {advancedSection} from "../../src/DrillInView/SchemaControls/agentTemplate/sections/AdvancedSection"
import {SecretsSectionBody} from "../../src/DrillInView/SchemaControls/agentTemplate/sections/SecretsSection"
import {
    agentaToolsView,
    advancedView,
    executionView,
} from "../../src/DrillInView/SchemaControls/agentTemplate/views/advancedViews"
import {SecretRemoveDialog} from "../../src/secret/SecretRemoveDialog"
import {secretAttachView} from "../../src/secret/views/secretAttachView"
import {secretFormView} from "../../src/secret/views/secretFormView"
import {secretFormDirty} from "../../src/secret/views/SecretFormViewBody"

import {byText, change, click, findByText, keyDown, waitFor} from "./domHelpers"

// The view bodies load on first open; load them once up front so no test pays for it.
beforeAll(async () => {
    await Promise.all([
        import("../../src/secret/views/SecretAttachViewBody"),
        import("../../src/secret/views/SecretFormViewBody"),
        import("../../src/DrillInView/SchemaControls/agentTemplate/views/AdvancedViewBody"),
        import("../../src/DrillInView/SchemaControls/agentTemplate/views/ExecutionViewBody"),
        import("../../src/DrillInView/SchemaControls/agentTemplate/views/AgentaToolsViewBody"),
    ])
}, 60_000)

const AGENT: ViewTarget = {kind: "agent_draft", revisionId: "rev-1"}
const PROJECT: ViewTarget = {kind: "project"}

const Chrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div>
        <nav>
            {crumbs.map((crumb, i) => (
                <span key={i}>{`here:${crumb.title}`}</span>
            ))}
        </nav>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

const Opener = <P,>({view, params, target}: {view: ViewDef<P>; params: P; target: ViewTarget}) => {
    const stack = useViewStack()
    return <button onClick={() => void stack.open(view, params, target)}>open</button>
}

let root: Root
let host: HTMLDivElement
const mount = async (element: ReturnType<typeof createElement>) => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={createStore()}>{element}</Provider>
            </QueryClientProvider>,
        ),
    )
}
const openIn = async <P,>(view: ViewDef<P>, params: P, target: ViewTarget) => {
    await mount(
        <ViewStackHost chrome={Chrome} rootTitle="Agent">
            <Opener view={view} params={params} target={target} />
        </ViewStackHost>,
    )
    await click(byText("open"))
}
/** Opens a Radix select with the keyboard and picks the option whose text starts with `text`. */
const choose = async (trigger: Element | null, text: string) => {
    expect(trigger).toBeTruthy()
    await keyDown(trigger!, "ArrowDown")
    await click(
        [...document.querySelectorAll('[role="option"]')].find((node) =>
            node.textContent?.startsWith(text),
        ),
    )
}
const options = async (trigger: Element) => {
    await keyDown(trigger, "ArrowDown")
    return [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent)
}
const saveButton = (label: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === label)
const envField = () => document.querySelector<HTMLInputElement>("#agent-secret-attach-env")!
const secretSelect = () => document.querySelector("#agent-secret-attach-secret")

const billing = {
    id: "s1",
    slug: "billing-prod",
    name: "billing-prod",
    format: "text",
    defaultEnvVar: "BILLING_API_KEY",
    type: "custom_secret",
}
const githubBot = {id: "s2", slug: "github-bot", name: "github-bot", format: "text"}
const mine = {id: "u1", slug: "my-github-token", name: "my-github-token", format: "text"}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    writer.agent = {sandbox: {kind: "local", credentials: []}}
    writer.schema = null
    writer.readOnly = false
    writer.update = vi.fn((next) => {
        writer.agent = next(writer.agent)
    })
    Object.assign(fx, {
        project: [billing, githubBot],
        own: [mine],
        access: "on",
        commits: [],
        commitError: null,
        choices: [],
        choiceOk: true,
        saved: [],
        committed: null,
        environments: ["local", "daytona"],
        order: [],
    })
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Attach a secret: the list and the scope tags", () => {
    it("lists project secrets as Everyone, own secrets as Only me, and Create new secret last", async () => {
        await openIn(secretAttachView, {}, AGENT)
        await findByText("here:Attach a secret")
        expect(await options(secretSelect()!)).toEqual([
            "billing-prodEveryone",
            "github-botEveryone",
            "my-github-tokenOnly me",
            "Create new secret",
        ])
        expect(document.body.textContent).not.toContain("Each person's own secret")
    })

    it("with personal accounts off, lists only the secrets for everyone", async () => {
        fx.access = "off"
        await openIn(secretAttachView, {}, AGENT)
        await findByText("here:Attach a secret")
        expect(await options(secretSelect()!)).toEqual([
            "billing-prodEveryone",
            "github-botEveryone",
            "Create new secret",
        ])
    })

    it("opens on Create new secret when there is nothing to pick", async () => {
        fx.project = []
        fx.own = []
        await openIn(secretAttachView, {}, AGENT)
        await findByText("Name", "label")
        expect(saveButton("Save & attach")).toBeTruthy()
    })
})

describe("Attach a secret: the attach", () => {
    it("a secret for everyone attaches by slug and saves a version at once", async () => {
        await openIn(secretAttachView, {}, AGENT)
        await findByText("here:Attach a secret")
        await choose(secretSelect(), "billing-prod")
        expect(envField().value).toBe("BILLING_API_KEY")
        expect(document.body.textContent).not.toContain("Only you can use this secret")
        await click(saveButton("Attach"))
        await waitFor(() => expect(fx.commits).toHaveLength(1))
        expect(fx.commits[0]).toEqual({
            revisionId: "rev-1",
            bindings: [
                {secret: {slug: "billing-prod"}, binding: {type: "env", name: "BILLING_API_KEY"}},
            ],
        })
        expect(fx.choices).toEqual([])
    })

    it("an own secret stores the account choice first, then attaches each person's own value", async () => {
        await openIn(secretAttachView, {}, AGENT)
        await findByText("here:Attach a secret")
        await choose(secretSelect(), "my-github-token")
        expect(document.body.textContent).toContain(
            "Only you can use this secret. Other people pick their own secret when they run the agent.",
        )
        await change(envField(), "GITHUB_TOKEN")
        await click(saveButton("Attach"))
        await waitFor(() => expect(fx.commits).toHaveLength(1))
        expect(fx.order).toEqual(["choice", "commit"])
        expect(fx.choices).toEqual([{secretId: "u1"}])
        expect(fx.commits[0]!.bindings).toEqual([
            {secret: {account_source: "user"}, binding: {type: "env", name: "GITHUB_TOKEN"}},
        ])
    })

    it("when the account choice cannot be stored, saves no version", async () => {
        fx.choiceOk = false
        await openIn(secretAttachView, {}, AGENT)
        await findByText("here:Attach a secret")
        await choose(secretSelect(), "my-github-token")
        await change(envField(), "GITHUB_TOKEN")
        await click(saveButton("Attach"))
        await findByText("Could not save your choice. Try again.")
        expect(fx.commits).toEqual([])
    })

    it("refuses a variable that starts with a digit or is already attached", async () => {
        writer.agent = {
            sandbox: {
                credentials: [{secret: {slug: "github-bot"}, binding: {type: "env", name: "GH"}}],
            },
        }
        await openIn(secretAttachView, {}, AGENT)
        await findByText("here:Attach a secret")
        await choose(secretSelect(), "billing-prod")
        await change(envField(), "1TOKEN")
        expect(document.body.textContent).toContain(
            "Use letters, digits, and underscores; do not start with a digit.",
        )
        expect(saveButton("Attach")!.disabled).toBe(true)
        await change(envField(), "GH")
        expect(document.body.textContent).toContain(
            "This secret or environment variable is already attached.",
        )
        expect(saveButton("Attach")!.disabled).toBe(true)
    })

    it("edits an attachment in place, by its variable, with Save", async () => {
        writer.agent = {
            sandbox: {
                credentials: [
                    {secret: {slug: "github-bot"}, binding: {type: "env", name: "GH"}},
                    {secret: {slug: "github-bot"}, binding: {type: "env", name: "OTHER"}},
                ],
            },
        }
        await openIn(secretAttachView, {envVar: "GH"}, AGENT)
        await findByText("here:Attach a secret")
        expect(envField().value).toBe("GH")
        await choose(secretSelect(), "billing-prod")
        await click(saveButton("Save"))
        await waitFor(() => expect(fx.commits).toHaveLength(1))
        expect(fx.commits[0]!.bindings).toEqual([
            {secret: {slug: "billing-prod"}, binding: {type: "env", name: "GH"}},
            {secret: {slug: "github-bot"}, binding: {type: "env", name: "OTHER"}},
        ])
    })
})

describe("Attach a secret: Save & attach", () => {
    const fillNew = async () => {
        await openIn(secretAttachView, {}, AGENT)
        await findByText("here:Attach a secret")
        await choose(secretSelect(), "Create new secret")
        await change(document.querySelector("#agent-secret-attach-name")!, "CRM_TOKEN")
        await change(document.querySelector("#agent-secret-attach-value")!, "crm-value")
    }

    it("a new secret for everyone goes to the vault, then the agent attaches it", async () => {
        await fillNew()
        await click(byText("Everyone in Acme Agency"))
        expect(envField().value).toBe("CRM_TOKEN")
        await click(saveButton("Save & attach"))
        await waitFor(() => expect(fx.commits).toHaveLength(1))
        expect(fx.order).toEqual(["vault", "commit"])
        expect(fx.saved[0]).toMatchObject({name: "CRM_TOKEN", content: "crm-value"})
        expect(fx.saved[0]!.ownerKind).toBeUndefined()
        expect(fx.commits[0]!.bindings).toEqual([
            {secret: {slug: "crm_token"}, binding: {type: "env", name: "CRM_TOKEN"}},
        ])
    })

    it("a new secret for me is the person's own, and the agent takes each person's value", async () => {
        await fillNew()
        await click(saveButton("Save & attach"))
        await waitFor(() => expect(fx.commits).toHaveLength(1))
        expect(fx.saved[0]!.ownerKind).toBe("user")
        expect(fx.order).toEqual(["vault", "choice", "commit"])
        expect(fx.choices).toEqual([{secretId: "new-secret-id"}])
        expect(fx.commits[0]!.bindings).toEqual([
            {secret: {account_source: "user"}, binding: {type: "env", name: "CRM_TOKEN"}},
        ])
    })

    it("saved but not attached: says so, keeps the secret picked, and Attach retries", async () => {
        fx.commitError = "boom"
        await fillNew()
        await click(byText("Everyone in Acme Agency"))
        await click(saveButton("Save & attach"))
        await findByText("Saved in vault; not attached. boom")
        fx.commitError = null
        await waitFor(() => expect(saveButton("Attach")?.disabled).toBe(false))
        await click(saveButton("Attach"))
        await waitFor(() => expect(fx.commits).toHaveLength(1))
        expect(fx.saved).toHaveLength(1)
        expect(fx.commits[0]!.bindings).toEqual([
            {secret: {slug: "crm_token"}, binding: {type: "env", name: "CRM_TOKEN"}},
        ])
    })
})

describe("The one secret form (Settings › Secrets)", () => {
    it("creates a secret in the project with Who can use it", async () => {
        await openIn(secretFormView, {owners: ["user", "project"]}, PROJECT)
        await findByText("here:Create secret")
        const [name] = [...document.querySelectorAll("input")]
        await change(name!, "STRIPE_KEY")
        await change(document.querySelector("textarea")!, "sk-1")
        await click(byText("Everyone in Acme Agency"))
        await click(saveButton("Create secret"))
        await waitFor(() => expect(fx.saved).toHaveLength(1))
        expect(fx.saved[0]).toMatchObject({name: "STRIPE_KEY", content: "sk-1"})
        expect(fx.saved[0]!.ownerKind).toBeUndefined()
    })

    it("edits a secret: the form opens with its values, and Save is off until a change", async () => {
        fx.project = [{...billing, content: "old"}]
        await openIn(secretFormView, {secretId: "s1"}, PROJECT)
        await findByText("here:Edit secret")
        expect(saveButton("Save")!.disabled).toBe(true)
        await change(document.querySelector("textarea")!, "new")
        expect(saveButton("Save")!.disabled).toBe(false)
    })
})

describe("Remove a secret attachment (F06 f3)", () => {
    it("a failure keeps the dialog open with the reason", async () => {
        const onRemove = vi.fn(async () => {
            throw new Error("conflict")
        })
        const onClose = vi.fn()
        await mount(<SecretRemoveDialog onRemove={onRemove} onClose={onClose} />)
        expect(document.body.textContent).toContain("Remove this secret attachment?")
        expect(document.body.textContent).toContain(
            "The agent will lose access to this variable. The secret stays in the project vault.",
        )
        await click(saveButton("Remove"))
        await findByText("conflict")
        expect(onClose).not.toHaveBeenCalled()
        await click(saveButton("Cancel"))
        expect(onClose).toHaveBeenCalled()
    })
})

describe("The Secrets section", () => {
    it("Remove saves a version without that attachment only", async () => {
        const bindings = [
            {
                secret: {slug: "billing-prod"},
                binding: {type: "env" as const, name: "BILLING_API_KEY"},
            },
            {secret: {slug: "github-bot"}, binding: {type: "env" as const, name: "GH"}},
        ]
        await mount(
            <SecretsSectionBody
                revisionId="rev-1"
                bindings={bindings}
                canEditSecrets
                openAttach={() => undefined}
            />,
        )
        const bins = [...document.querySelectorAll('button[aria-label="Remove"]')]
        expect(bins).toHaveLength(2)
        await click(bins[1])
        await click(saveButton("Remove"))
        await waitFor(() => expect(fx.commits).toHaveLength(1))
        expect(fx.commits[0]).toEqual({revisionId: "rev-1", bindings: [bindings[0]]})
        await waitFor(() => expect(document.body.textContent).not.toContain("Remove this secret"))
    })
})

describe("The secret form's unsaved state", () => {
    const json = {
        id: "j1",
        name: "service",
        slug: "service",
        format: "json",
        content: {region: "eu"},
    } as never
    const form = (patch: Record<string, unknown>) =>
        ({
            name: "service",
            textValue: "",
            defaultEnvVar: "",
            format: "json",
            jsonView: "grid",
            jsonText: "{}",
            kvRows: [{key: "region", value: "eu"}],
            ...patch,
        }) as never

    it("is clean when the form holds the saved value", () => {
        expect(secretFormDirty(form({}), json)).toBe(false)
        expect(secretFormDirty(form({jsonView: "json", jsonText: '{"region": "eu"}'}), json)).toBe(
            false,
        )
    })

    it("counts an edit in the JSON editor, text that does not parse, and a row with no key yet", () => {
        expect(secretFormDirty(form({jsonView: "json", jsonText: '{"region": "us"}'}), json)).toBe(
            true,
        )
        expect(secretFormDirty(form({jsonView: "json", jsonText: '{"region": '}), json)).toBe(true)
        expect(
            secretFormDirty(
                form({
                    kvRows: [
                        {key: "region", value: "eu"},
                        {key: "", value: "x"},
                    ],
                }),
                json,
            ),
        ).toBe(true)
    })
})

describe("Advanced", () => {
    const sandboxSchema = (kinds: string[]) => ({
        type: "object",
        properties: {sandbox: {type: "object", properties: {kind: {type: "string", enum: kinds}}}},
    })

    it("lists Execution and Agenta tools with their summaries", async () => {
        writer.schema = sandboxSchema(["local", "daytona"])
        await openIn(advancedView, {}, AGENT)
        await findByText("here:Advanced")
        const execution = await findByText("", '[data-testid="advanced-part-execution"]')
        expect(execution.textContent).toContain("Sandbox: local")
        const tools = document.querySelector('[data-testid="advanced-part-agenta-tools"]')!
        expect(tools.textContent).toContain("Agenta tools")
        expect(tools.textContent).toContain("· 2 tools")
        expect(document.querySelector('[data-testid="advanced-part-build-kit"]')).toBeNull()
    })

    it("the Configuration page's Advanced card shows the same rows as the view", async () => {
        writer.schema = sandboxSchema(["local", "daytona"])
        await openIn(advancedView, {}, AGENT)
        await findByText("", '[data-testid="advanced-part-execution"]')
        const viewRows = [...document.querySelectorAll('[data-testid^="advanced-part-"]')].map(
            (row) => row.textContent,
        )
        const opened: unknown[] = []
        const section = advancedSection({
            t: ((key: string) => key) as never,
            mh: {hasAdvanced: true} as never,
            sectionIndicator: () => undefined,
            advancedChangeBody: null,
            openAdvanced: (view) => opened.push(view),
            schema: writer.schema as never,
            config: writer.agent,
            revisionId: "rev-1",
        })
        if (!section) throw new Error("no Advanced section")
        await mount(<div data-testid="page-card">{section.pageContent}</div>)
        const pageRows = [...document.querySelectorAll('[data-testid="page-card"] button')].map(
            (row) => row.textContent,
        )
        expect(pageRows).toEqual(viewRows)
        await click(document.querySelector('[data-testid="page-card"] button'))
        expect(opened).toEqual([executionView])
    })

    it("hides Execution with one sandbox", async () => {
        fx.environments = ["local"]
        writer.schema = sandboxSchema(["local", "daytona"])
        await openIn(advancedView, {}, AGENT)
        await findByText("", '[data-testid="advanced-part-agenta-tools"]')
        expect(document.querySelector('[data-testid="advanced-part-execution"]')).toBeNull()
    })

    it("Execution: a pick changes the configuration at once and never offers in-process", async () => {
        fx.environments = ["local", "daytona", "inprocess"]
        writer.schema = sandboxSchema(["local", "daytona", "inprocess"])
        await openIn(executionView, {}, AGENT)
        await findByText("here:Execution")
        const trigger = document.querySelector('[role="combobox"]')!
        expect(await options(trigger)).toEqual(["Local", "Daytona"])
        await click([...document.querySelectorAll('[role="option"]')][1])
        expect((writer.agent.sandbox as {kind: string}).kind).toBe("daytona")
        expect(byText("Done")).toBeTruthy()
    })

    it("Execution: Revert puts back the saved sandbox", async () => {
        writer.schema = sandboxSchema(["local", "daytona"])
        writer.agent = {sandbox: {kind: "daytona"}}
        fx.committed = {agent: {sandbox: {kind: "local"}}}
        await openIn(executionView, {}, AGENT)
        await findByText("here:Execution")
        await click(saveButton("Revert"))
        await click(
            [...document.querySelectorAll('[role="dialog"] button')].find(
                (b) => b.textContent === "Revert",
            ),
        )
        expect((writer.agent.sandbox as {kind: string}).kind).toBe("local")
    })

    it("Execution: read only shows the sandbox as text, with no select and no Revert", async () => {
        writer.schema = sandboxSchema(["local", "daytona"])
        writer.agent = {sandbox: {kind: "daytona"}}
        writer.readOnly = true
        fx.committed = {agent: {sandbox: {kind: "local"}}}
        await openIn(executionView, {}, AGENT)
        await findByText("here:Execution")
        expect(document.querySelector('[role="combobox"]')).toBeNull()
        expect(byText("Daytona")).toBeTruthy()
        expect(saveButton("Revert")).toBeFalsy()
    })

    it("Agenta tools: a preset resets every tool, and Save applies the form", async () => {
        writer.agent = {tools: []}
        await openIn(agentaToolsView, {}, AGENT)
        await findByText("here:Agenta tools")
        await choose(document.querySelector('[aria-label="Default permission"]'), "Allow all")
        expect(writer.update).not.toHaveBeenCalled()
        await click(saveButton("Save"))
        expect(writer.update).toHaveBeenCalledTimes(1)
        const entry = (writer.agent.tools as Record<string, unknown>[])[0]
        expect(JSON.stringify(entry)).toContain('"get_current_session":"allow"')
        expect(JSON.stringify(entry)).toContain('"create_schedule":"allow"')
    })
})
