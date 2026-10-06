// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    templateBuilderMessage: () => "Set up a PR reviewer and review my open pull requests.",
    templateProviderSlugs: () => [],
}))
vi.mock("@agenta/home-ui", () => ({TemplateProviderMarks: () => null}))
vi.mock("@agenta/ui/agent-icon", () => ({
    AGENT_ICON_COLORS: [
        ["#111111", "#eeeeee"],
        ["#222222", "#dddddd"],
    ],
    AGENT_ICON_CHIP_CLASS: "",
    AgentIcon: () => null,
    agentIconChipStyle: () => ({}),
    loadAgentIconCatalog: () => Promise.resolve([]),
}))
vi.mock("@/components/AgentaLogo", () => ({AgentaLogo: () => null}))
vi.mock("motion/react", () => ({
    AnimatePresence: ({children}: {children: ReactNode}) => <>{children}</>,
    motion: {section: ({children}: {children: ReactNode}) => <section>{children}</section>},
    useReducedMotion: () => true,
}))

import type {OnboardingCatalog} from "@/features/onboarding/onboardingChoices"
import {ONBOARDING_STEPS} from "@/features/onboarding/onboardingDraft"
import {OnboardingFlow, type OnboardingFlowProps} from "@/features/onboarding/OnboardingFlow"
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
            description: "Review changes",
            example: {prompt: "Review my pull requests", steps: ["Read the diff"], reply: "Done"},
        },
    ],
} as unknown as OnboardingCatalog

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
    window.sessionStorage.clear()
})

const baseProps = (overrides: Partial<OnboardingFlowProps> = {}): OnboardingFlowProps => ({
    variant: "control",
    draftKey: "onboarding:test",
    steps: ONBOARDING_STEPS,
    catalog,
    tools: <p>Tools</p>,
    model: <p>Models</p>,
    modelReady: true,
    modelNextLabel: "Continue with credits",
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
const heading = () => host!.querySelector("h1")?.textContent
const type = (label: string, value: string) => {
    const field = Array.from(host!.querySelectorAll("label"))
        .find((item) => item.textContent?.startsWith(label))
        ?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!
    act(() => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const toAgentStep = () => {
    click("Engineering")
    click(/^Next/)
    click(/^Next/)
    click(/^Continue with credits/)
    click("GitHub")
    click(/^Next/)
}

describe("first agent onboarding", () => {
    it("keeps answers and the step across a remount, and per project", () => {
        const props = baseProps()
        render(props)
        click("Engineering")
        click(/^Next/)
        render(props)
        expect(heading()).toBe("What do you use every day?")
        click(/^Next/)
        click(/^Continue with credits/)
        click("GitHub")
        click(/^Next/)
        type("Name", "My agent")
        render(props)
        click("Get started")
        expect(props.onCreate).toHaveBeenCalledWith({
            name: "My agent",
            seedMessage: "Set up My agent: help me define what this agent should do.",
            icon: null,
        })
        render(baseProps({draftKey: "onboarding:other"}))
        expect(heading()).toBe("What will you be working on most?")
    })

    it("requires a runnable model before continuing", () => {
        render(baseProps({modelReady: false}))
        click("Engineering")
        click(/^Next/)
        click(/^Next/)
        expect(button(/^Continue with credits/).disabled).toBe(true)
    })

    it("creates name-first with the edited name and the picked template's first message", () => {
        const props = baseProps()
        render(props)
        toAgentStep()
        expect(button("Get started").disabled).toBe(true)
        click(/PR reviewer/)
        type("Name", "My reviewer")
        click("Get started")
        expect(props.onCreate).toHaveBeenCalledWith({
            name: "My reviewer",
            seedMessage: "Set up a PR reviewer and review my open pull requests.",
            icon: {icon: "git-pull-request", color: "#222222"},
        })
    })

    it("labels task-first examples as illustrations and creates from the task", () => {
        const props = baseProps({variant: "task-first"})
        render(props)
        toAgentStep()
        click(/^Review my open pull requests/)
        expect(host!.textContent).toContain("Illustration only. Your agent hasn't run yet.")
        click("Set up this agent")
        expect(props.onCreate).toHaveBeenCalledWith({
            name: "PR reviewer",
            seedMessage: "Set up a PR reviewer and review my open pull requests.",
            icon: {icon: "git-pull-request", color: "#222222"},
        })
    })

    it("clears the template pick when the role changes", () => {
        render(baseProps())
        toAgentStep()
        click(/PR reviewer/)
        for (let index = 0; index < 4; index++) click("Back")
        click("Sales")
        click(/^Next/)
        click(/^Next/)
        click(/^Continue with credits/)
        click(/^Next/)
        expect(() => button(/PR reviewer/)).toThrow()
        expect(button("Get started").disabled).toBe(true)
    })

    it("records a completed step only when moving forward", () => {
        const onStepCompleted = vi.fn()
        render(baseProps({onStepCompleted}))
        click("Engineering")
        click(/^Next/)
        expect(onStepCompleted).toHaveBeenCalledOnce()
        expect(onStepCompleted.mock.calls[0][0]).toBe("role")
        click("Back")
        expect(onStepCompleted).toHaveBeenCalledOnce()
    })

    it("stays usable while suggestions load or fail", () => {
        const retry = vi.fn()
        const onCreate = vi.fn()
        render(baseProps({onCreate, catalog: {templates: [], status: "pending", retry}}))
        toAgentStep()
        expect(host!.querySelector('[aria-label="Loading suggestions"]')).not.toBeNull()
        render(baseProps({onCreate, catalog: {templates: [], status: "error", retry}}))
        click("Try again")
        expect(retry).toHaveBeenCalledOnce()
        type("Name", "My agent")
        click("Get started")
        expect(onCreate).toHaveBeenCalledWith({
            name: "My agent",
            seedMessage: "Set up My agent: help me define what this agent should do.",
            icon: null,
        })
    })

    it("waits for the catalog before creating from a restored template pick", () => {
        window.sessionStorage.setItem(
            "onboarding:test",
            JSON.stringify({
                step: "agent",
                role: "Engineering",
                source: "GitHub",
                name: "",
                task: "",
                pick: {kind: "template", key: "review"},
                icon: null,
            }),
        )
        const props = baseProps({variant: "task-first"})
        render({...props, catalog: {templates: [], status: "pending", retry: vi.fn()}})
        expect(button("Set up this agent").disabled).toBe(true)
        render(props)
        click("Set up this agent")
        expect(props.onCreate).toHaveBeenCalledWith({
            name: "PR reviewer",
            seedMessage: "Set up a PR reviewer and review my open pull requests.",
            icon: null,
        })
    })

    it("skips the tools step when the deployment has none", () => {
        render(baseProps({steps: ["role", "model", "referral", "agent"]}))
        click("Engineering")
        click(/^Next/)
        expect(host!.textContent).toContain("Models")
        expect(host!.textContent).toContain("Step 2 of 4")
    })
})
