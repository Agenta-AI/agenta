// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    PROVIDERS: {},
    composioLogo: (slug: string) => slug,
    templateBuilderMessage: () => "Build a PR reviewer that comments inline.",
    templateCategories: (templates: {category: string}[]) => [
        ...new Set(templates.map((item) => item.category)),
    ],
    templateProviderSlugs: () => ["github"],
}))
vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    isConnectionValid: () => true,
    useToolConnectionsQuery: () => ({connections: [], isLoading: false, error: null}),
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({
    useDirectToolConnect: () => ({connect: vi.fn(), connectingKey: null}),
}))
vi.mock("@agenta/entity-ui/secretProvider", () => ({
    ProviderDrawer: () => null,
    SubscriptionConnectionCard: () => null,
}))
vi.mock("@agenta/home-ui", () => ({TemplateProviderMarks: () => null}))
vi.mock("@agenta/ui/components/presentational", () => ({
    LoadError: ({title, onRetry}: {title: string; onRetry: () => void}) => (
        <p>
            {title}
            <button type="button" onClick={onRetry}>
                Try again
            </button>
        </p>
    ),
}))
vi.mock("@agenta/ui/agent-icon", () => ({
    AGENT_ICON_CHIP_CLASS: "",
    DEFAULT_AGENT_ICON: {icon: "robot", color: "#111111"},
    AgentIcon: () => null,
    agentIconChipStyle: () => ({}),
    loadAgentIconCatalog: () => Promise.resolve([]),
}))
vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@/components/AgentaLogo", () => ({AgentaLogo: () => null}))
vi.mock("motion/react", async () => {
    const {createElement} = await import("react")
    // Any motion.<tag> renders the plain tag with its class; the animation props are dropped.
    const tags = new Map<string, (props: {children?: ReactNode; className?: string}) => ReactNode>()
    const plain = (tag: string) => {
        if (!tags.has(tag)) {
            tags.set(tag, ({children, className}) => createElement(tag, {className}, children))
        }
        return tags.get(tag)!
    }
    return {
        AnimatePresence: ({children}: {children: ReactNode}) => <>{children}</>,
        motion: new Proxy({}, {get: (_, tag: string) => plain(tag)}),
        useIsPresent: () => true,
        useReducedMotion: () => true,
    }
})

import type {OnboardingCatalog} from "@/features/onboarding/onboardingChoices"
import {OnboardingFlow, type OnboardingFlowProps} from "@/features/onboarding/OnboardingFlow"
import type {OnboardingModel} from "@/features/onboarding/useOnboardingModel"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const catalog = {
    status: "success",
    retry: () => undefined,
    templates: [
        {
            key: "review",
            name: "PR reviewer",
            category: "Engineering",
            initials: "PR",
            color: "#123456",
            description: "Reviews changes",
            instructions: "Review each opened PR.",
            trigger: "Pull request opened",
            triggerDescription: "Runs when a pull request is opened.",
            connections: [],
        },
    ],
} as unknown as OnboardingCatalog

const model = (ready = true): OnboardingModel => ({
    status: "ready",
    ready,
    credits: ready ? {inUse: true, runnable: true, balance: "500"} : null,
    chatgpt: {
        available: false,
        connection: null,
        ready: false,
        inUse: false,
        dialogOpen: false,
        setDialogOpen: vi.fn(),
    },
    keys: {
        connections: [],
        inUse: false,
        drawerOpen: false,
        openDrawer: vi.fn(),
        closeDrawer: vi.fn(),
        onSaved: vi.fn(),
        all: [],
    },
    retry: vi.fn(),
})

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
    window.sessionStorage.clear()
    vi.useRealTimers()
})

const baseProps = (overrides: Partial<OnboardingFlowProps> = {}): OnboardingFlowProps => ({
    draftKey: "onboarding:test",
    catalog,
    model: model(),
    connectedApps: new Map([["github", "GitHub"]]),
    toolsEnabled: false,
    creating: false,
    onStepCompleted: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
})

const render = (props: OnboardingFlowProps) => {
    if (root) act(() => root!.unmount())
    host?.remove()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<OnboardingFlow {...props} />))
}

const button = (name: string | RegExp) => {
    const match = Array.from(host!.querySelectorAll("button")).find((item) => {
        const label = item.getAttribute("aria-label") ?? item.textContent?.trim() ?? ""
        return typeof name === "string" ? label === name : name.test(label)
    })
    if (!match) throw new Error(`no button ${name}`)
    return match
}
const click = (name: string | RegExp) => act(() => button(name).click())
const answer = (name: RegExp) => {
    click(name)
    act(() => vi.runOnlyPendingTimers())
}
const heading = () => host!.querySelector("h1")?.textContent
const type = (placeholder: string, value: string) => {
    const field = host!.querySelector(`[placeholder^="${placeholder}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!
    act(() => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const toGallery = () => {
    answer(/^Engineering/)
    answer(/^GitHub/)
    click(/^Continue/)
}

describe("first agent onboarding", () => {
    it("answers a question by its letter key and moves on", () => {
        const onStepCompleted = vi.fn()
        render(baseProps({onStepCompleted}))
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", {key: "a"}))
        })
        act(() => vi.runOnlyPendingTimers())
        expect(heading()).toBe("How did you hear about Agenta?")
        expect(onStepCompleted).toHaveBeenCalledWith(
            "role",
            expect.objectContaining({role: "Engineering"}),
        )
        answer(/^GitHub/)
        expect(heading()).toBe("Choose how your agents run")
        expect(onStepCompleted).toHaveBeenLastCalledWith(
            "referral",
            expect.objectContaining({source: "GitHub"}),
        )
    })

    it("keeps answers and the step across a remount, and per project", () => {
        const props = baseProps()
        render(props)
        answer(/^Engineering/)
        answer(/^GitHub/)
        render(props)
        expect(heading()).toBe("Choose how your agents run")
        expect(host!.textContent).toContain("500 credits left.")
        render(baseProps({draftKey: "onboarding:other"}))
        expect(heading()).toBe("What kind of work do you do?")
    })

    it("locks a template's name and instructions and creates from its package", () => {
        const props = baseProps()
        render(props)
        toGallery()
        expect(heading()).toBe("Create your first agent")
        click("Use template")
        expect(heading()).toBe("Review your agent")
        expect(host!.querySelector('[placeholder="My first agent"]')).toBeNull()
        const locked = host!.querySelector('[aria-label="From the template"]')!
        expect(locked.textContent).toContain("PR reviewer")
        expect(locked.textContent).toContain("Review each opened PR.")
        expect(
            (host!.querySelector('[placeholder="What should it do first?"]') as HTMLTextAreaElement)
                .value,
        ).toBe("")
        click("Create agent")
        expect(props.onCreate).toHaveBeenCalledWith({
            name: "PR reviewer",
            instructions: "",
            firstMessage: "",
            templateKey: "review",
            icon: {icon: "code", color: "#123456"},
            apps: ["github"],
        })
    })

    it("keeps the creator's edits through a detour to choose a model and a re-picked template", () => {
        const props = baseProps({model: model(false)})
        render(props)
        toGallery()
        click("Use template")
        type("What should it do first?", "Review PR 12")
        click("Choose one")
        expect(heading()).toBe("Choose how your agents run")
        render({...props, model: model(true)})
        click(/^Continue/)
        expect(heading()).toBe("Review your agent")
        const message = () =>
            (host!.querySelector('[placeholder="What should it do first?"]') as HTMLTextAreaElement)
                .value
        expect(message()).toBe("Review PR 12")
        click("Back")
        click("Use template")
        expect(message()).toBe("Review PR 12")
    })

    it("starts blank and needs something to do before Create", () => {
        const props = baseProps()
        render(props)
        toGallery()
        click("Use template")
        click("Back")
        click(/^Start from scratch/)
        expect(heading()).toBe("Create your agent")
        expect(host!.querySelector('[aria-label="From the template"]')).toBeNull()
        expect(button("Create agent").disabled).toBe(true)
        type("My first agent", "Atlas")
        click("Review my open pull requests")
        click("Create agent")
        expect(props.onCreate).toHaveBeenCalledWith({
            name: "Atlas",
            instructions: "",
            firstMessage: "Review my open pull requests",
            templateKey: null,
            icon: {icon: "robot", color: "#111111"},
            apps: [],
        })
    })

    it("says why Create is off without a model, and goes back to choose one", () => {
        render(baseProps({model: model(false)}))
        toGallery()
        click(/^Start from scratch/)
        type("What should it do first?", "Plan my week")
        expect(button("Create agent").disabled).toBe(true)
        expect(host!.textContent).toContain("Your agent needs a model to run.")
        click("Choose one")
        expect(heading()).toBe("Choose how your agents run")
        expect(host!.textContent).toContain("No model can run your agent yet.")
    })

    it("reports each completed step once, and never on Back", () => {
        const onStepCompleted = vi.fn()
        render(baseProps({onStepCompleted}))
        answer(/^Engineering/)
        expect(onStepCompleted).toHaveBeenCalledOnce()
        click("Back")
        expect(heading()).toBe("What kind of work do you do?")
        expect(onStepCompleted).toHaveBeenCalledOnce()
        answer(/^Product/)
        expect(heading()).toBe("How did you hear about Agenta?")
        expect(onStepCompleted).toHaveBeenCalledOnce()
    })

    it("keeps a blank start open while templates load or fail", () => {
        const retry = vi.fn()
        render(baseProps({catalog: {templates: [], status: "pending", retry}}))
        toGallery()
        expect(host!.querySelector('[aria-label="Loading templates"]')).not.toBeNull()
        render(baseProps({catalog: {templates: [], status: "error", retry}}))
        click("Try again")
        expect(retry).toHaveBeenCalledOnce()
        click(/^Start from scratch/)
        expect(heading()).toBe("Create your agent")
    })

    it("moves focus to the new step's heading and labels the choices by it", () => {
        render(baseProps())
        const roles = host!.querySelector('[role="group"]')!
        expect(document.getElementById(roles.getAttribute("aria-labelledby")!)?.textContent).toBe(
            "What kind of work do you do?",
        )
        answer(/^Engineering/)
        expect(document.activeElement?.textContent).toBe("How did you hear about Agenta?")
    })
})
