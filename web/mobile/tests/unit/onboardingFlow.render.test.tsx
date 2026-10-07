// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    ALL_TEMPLATES_CATEGORY: "All",
    categorySlug: (category: string) => category.toLowerCase(),
    PROVIDERS: {
        github: {label: "GitHub", logo: "github.svg"},
        slack: {label: "Slack", logo: "slack.svg"},
    },
    composioLogo: (slug: string) => slug,
    templateBuilderMessage: () => "Build a PR reviewer that comments inline.",
    templateCategories: (templates: {category: string}[]) => [
        ...new Set(templates.map((item) => item.category)),
    ],
    templateProviderSlugs: () => ["github", "slack"],
}))
// The project's tool connections, as a store a test can refetch into.
const tools = vi.hoisted(() => {
    let list: {integration_key: string}[] = []
    const listeners = new Set<() => void>()
    return {
        get list() {
            return list
        },
        set: (next: {integration_key: string}[]) => {
            list = next
            listeners.forEach((listener) => listener())
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        connect: vi.fn(),
    }
})
vi.mock("@agenta/entities/gatewayTool", async () => {
    const {useSyncExternalStore} = await import("react")
    return {
        isConnectionActive: () => true,
        isConnectionValid: () => true,
        useToolConnectionsQuery: () => ({
            connections: useSyncExternalStore(tools.subscribe, () => tools.list),
            isLoading: false,
            error: null,
        }),
    }
})
vi.mock("@agenta/entity-ui/gatewayTool", () => ({
    useDirectToolConnect: () => ({connect: tools.connect, connectingKey: null}),
}))
vi.mock("@agenta/shared/api/env", () => ({isToolsEnabled: () => true}))
vi.mock("@agenta/entity-ui/secretProvider", () => ({
    KEY_PROVIDERS: [],
    ProviderDrawer: () => null,
    SubscriptionConnectionCard: () => null,
}))
// The composer as a textarea: the real one is a lazy Lexical editor.
vi.mock("@agenta/home-ui", async () => {
    const {useImperativeHandle, useState} = await import("react")
    const HomeTaskComposer = ({
        placeholder = "Describe the agent you want",
        initialMarkdown = "",
        onChange,
        onCreate,
        inputRef,
        hideDock,
        sending,
    }: {
        placeholder?: string
        initialMarkdown?: string
        onChange?: (text: string) => void
        onCreate?: (input: {text: string}) => unknown
        inputRef?: {current: unknown}
        hideDock?: boolean
        sending?: boolean
    }) => {
        const [text, setText] = useState(initialMarkdown)
        const edit = (next: string) => {
            setText(next)
            onChange?.(next)
        }
        useImperativeHandle(inputRef, () => ({setMarkdown: async (next: string) => edit(next)}))
        return (
            <div>
                <textarea
                    placeholder={placeholder}
                    value={text}
                    onChange={(event) => edit(event.target.value)}
                />
                {hideDock ? null : <span data-dock />}
                <button
                    type="button"
                    aria-label="Send"
                    disabled={sending || !text.trim()}
                    onClick={async () => {
                        const sent = text.trim()
                        edit("")
                        if ((await onCreate?.({text: sent})) === false) edit(sent)
                    }}
                />
            </div>
        )
    }
    return {HomeTaskComposer, TemplateProviderMarks: () => null}
})
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
    AGENT_ICON_COLORS: [
        ["#111111", "#eeeeee"],
        ["#222222", "#dddddd"],
    ],
    AGENT_ICON_CONIC: "conic-gradient(#111111,#222222)",
    DEFAULT_AGENT_ICON: {icon: "robot", color: "#111111"},
    AgentIcon: () => null,
    agentIconChipStyle: () => ({}),
    hexToHsv: () => ({h: 0, s: 0, v: 0}),
    hsvToHex: () => "#333333",
    loadAgentIconCatalog: () => Promise.resolve([]),
    tintForColor: () => "#eeeeee",
}))
vi.mock("next/dynamic", () => ({default: () => () => null}))
// A phone-width router with a history: the step is the path after `/onboarding`.
const nav = vi.hoisted(() => {
    const BASE = "/w/ws/p/pr/onboarding"
    const parse = (url: string) => {
        const [path, search = ""] = url.split("?")
        const segments = path.slice(BASE.length).split("/").filter(Boolean)
        const query: Record<string, string | string[]> = segments.length ? {step: segments} : {}
        new URLSearchParams(search).forEach((value, key) => {
            query[key] = value
        })
        return query
    }
    let entries = [BASE]
    let index = 0
    let query = parse(BASE)
    const listeners = new Set<() => void>()
    const emit = () => {
        query = parse(entries[index])
        listeners.forEach((listener) => listener())
    }
    return {
        BASE,
        get url() {
            return entries[index]
        },
        get query() {
            return query
        },
        open: (url: string) => {
            entries = [url]
            index = 0
            emit()
        },
        reset: () => {
            entries = [BASE]
            index = 0
            query = parse(BASE)
        },
        forward: () => {
            if (index < entries.length - 1) index += 1
            emit()
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        router: {
            isReady: true,
            get query() {
                return query
            },
            push: (url: string) => {
                entries = [...entries.slice(0, index + 1), url]
                index += 1
                emit()
                return Promise.resolve(true)
            },
            replace: (url: string) => {
                entries[index] = url
                emit()
                return Promise.resolve(true)
            },
            back: () => {
                if (index > 0) index -= 1
                emit()
            },
        },
    }
})
vi.mock("next/router", async () => {
    const {useSyncExternalStore} = await import("react")
    return {
        useRouter: () => {
            useSyncExternalStore(nav.subscribe, () => nav.query)
            return nav.router
        },
    }
})
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
import {personProperties} from "@/features/onboarding/onboardingQuestions"
import {
    onboardingSteps,
    stepIndex,
    type OnboardingStep,
} from "@/features/onboarding/onboardingRoute"
import type {OnboardingModel} from "@/features/onboarding/useOnboardingModel"

import {registerQuestion, TEAM_QUESTION, withTestQuestions} from "./onboardingTestQuestion"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

withTestQuestions()

const catalog = {
    status: "success",
    retry: () => undefined,
    templates: [
        {
            key: "pr-reviewer",
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
    credits: ready ? {inUse: true, runnable: true, balanceMusd: 5_000_000} : null,
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
    tools.set([])
    tools.connect.mockReset()
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
    window.sessionStorage.clear()
    nav.reset()
    vi.useRealTimers()
})

const baseProps = (overrides: Partial<OnboardingFlowProps> = {}): OnboardingFlowProps => ({
    onboardingPath: nav.BASE,
    draftKey: "onboarding:test",
    steps: onboardingSteps(),
    catalog,
    model: model(),
    connectedApps: new Map([["github", "GitHub"]]),
    creating: false,
    attachments: {} as OnboardingFlowProps["attachments"],
    onStepCompleted: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve(true)),
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
const send = () => act(async () => button("Send").click())
const message = (placeholder: string) =>
    (host!.querySelector(`[placeholder^="${placeholder}"]`) as HTMLTextAreaElement).value
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
const browserBack = () => act(() => nav.router.back())
const browserForward = () => act(() => nav.forward())
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
            "persona",
            expect.objectContaining({answers: {persona: "Engineering"}}),
        )
        answer(/^GitHub/)
        expect(heading()).toBe("500 credits, on us")
        expect(onStepCompleted).toHaveBeenLastCalledWith(
            "source",
            expect.objectContaining({answers: {persona: "Engineering", source: "GitHub"}}),
        )
    })

    it("puts each step in the URL and keeps the answers across a remount", () => {
        const props = baseProps()
        render(props)
        expect(nav.url).toBe(`${nav.BASE}/persona`)
        answer(/^Engineering/)
        expect(nav.url).toBe(`${nav.BASE}/source`)
        answer(/^GitHub/)
        expect(nav.url).toBe(`${nav.BASE}/credits`)
        render(props)
        expect(heading()).toBe("500 credits, on us")
        expect(host!.textContent).toContain("That’s $5.00 to spend on any model.")
        // Another user's draft has no answers, so the same URL falls back to the first step.
        render(baseProps({draftKey: "onboarding:other"}))
        expect(heading()).toBe("What kind of work do you do?")
        expect(nav.url).toBe(`${nav.BASE}/persona`)
    })

    it("walks the steps with the browser's Back and Forward", () => {
        render(baseProps())
        toGallery()
        browserBack()
        expect(heading()).toBe("500 credits, on us")
        browserBack()
        expect(heading()).toBe("How did you hear about Agenta?")
        browserForward()
        browserForward()
        expect(heading()).toBe("Create your first agent")
    })

    it("sends a link to a step not yet reached to the furthest one the answers open", () => {
        nav.open(`${nav.BASE}/templates`)
        render(baseProps())
        expect(heading()).toBe("What kind of work do you do?")
        expect(nav.url).toBe(`${nav.BASE}/persona`)
        answer(/^Engineering/)
        answer(/^GitHub/)
        act(() => nav.open(`${nav.BASE}/review`))
        expect(heading()).toBe("Create your first agent")
        expect(nav.url).toBe(`${nav.BASE}/templates`)
    })

    it("creates a template from its package with Use template, its connected apps and look", async () => {
        const props = baseProps()
        render(props)
        toGallery()
        expect(host!.textContent).toContain("Creates the agent and opens it.")
        await act(async () => button("Use template").click())
        expect(props.onCreate).toHaveBeenCalledWith({
            name: "PR reviewer",
            firstMessage: "",
            templateKey: "pr-reviewer",
            icon: {icon: "git-pull-request", color: "#123456"},
            apps: ["github"],
        })
        render({...props, creating: true})
        expect(button("Creating agent").getAttribute("aria-busy")).toBe("true")
        render({...props, error: "Couldn't create the agent"})
        expect(host!.querySelector('[role="alert"]')?.textContent).toBe("Couldn't create the agent")
    })

    it("connects a template's apps in place and counts them", () => {
        const connection = (key: string) => ({
            slug: key,
            name: key,
            provider_key: "composio",
            integration_key: key,
        })
        tools.set([connection("github")])
        render(baseProps())
        toGallery()
        expect(host!.textContent).toContain("Connects · 1 of 2 connected")
        expect(() => button("Connect GitHub")).toThrow()
        click("Connect Slack")
        expect(tools.connect).toHaveBeenCalledWith({
            integrationKey: "slack",
            integrationName: "Slack",
            existingCount: 0,
        })
        act(() => tools.set([connection("github"), connection("slack")]))
        expect(host!.textContent).toContain("Connects · 2 of 2 connected")
        expect(() => button("Connect Slack")).toThrow()
    })

    it("blocks Use template without a model and returns to the template after choosing one", () => {
        const props = baseProps({model: model(false)})
        render(props)
        toGallery()
        click(/^PR reviewer/)
        expect(button("Use template").disabled).toBe(true)
        expect(host!.textContent).toContain("Your agent needs a model to run.")
        click("Choose one")
        expect(props.onCreate).not.toHaveBeenCalled()
        expect(nav.url).toBe(`${nav.BASE}/credits?return=templates%2Fpr-reviewer`)
        render({...props, model: model(true)})
        click(/^Continue/)
        expect(nav.url).toBe(`${nav.BASE}/templates/pr-reviewer`)
        expect(button("Use template").disabled).toBe(false)
    })

    it("builds a blank start in the gallery and creates from its first message", async () => {
        const props = baseProps()
        render(props)
        toGallery()
        click(/^New agent/)
        expect(heading()).toBe("Create your first agent")
        expect(host!.querySelector("[data-dock]")).toBeNull()
        expect(button("Send").disabled).toBe(true)
        type("Name your agent", "Atlas")
        click("Review my open pull requests")
        expect(message("Describe the agent")).toBe("Review my open pull requests")
        render(props)
        expect(message("Describe the agent")).toBe("Review my open pull requests")
        await send()
        expect(props.onCreate).toHaveBeenCalledWith({
            name: "Atlas",
            firstMessage: "Review my open pull requests",
            templateKey: null,
            icon: {icon: "robot", color: "#111111"},
            apps: [],
        })
    })

    it("saves the draft once edits pause, and at once when the page hides or unmounts", () => {
        render(baseProps())
        toGallery()
        click(/^New agent/)
        const savedName = () =>
            JSON.parse(window.sessionStorage.getItem("onboarding:test") ?? "{}").agent?.name
        type("Name your agent", "Atl")
        expect(savedName()).toBe("")
        act(() => vi.advanceTimersByTime(300))
        expect(savedName()).toBe("Atl")
        type("Name your agent", "Atlas")
        expect(savedName()).toBe("Atl")
        act(() => window.dispatchEvent(new Event("pagehide")))
        expect(savedName()).toBe("Atlas")
        type("Name your agent", "Atlas 2")
        act(() => root!.unmount())
        root = undefined
        expect(savedName()).toBe("Atlas 2")
    })

    it("keeps the message and points at the model note when sent without a model", async () => {
        const props = baseProps({model: model(false)})
        render(props)
        toGallery()
        click(/^New agent/)
        type("Describe the agent", "Plan my week")
        expect(host!.textContent).toContain("Your agent needs a model to run.")
        await send()
        expect(props.onCreate).not.toHaveBeenCalled()
        expect(message("Describe the agent")).toBe("Plan my week")
        expect(document.activeElement).toBe(button("Choose one"))
        click("Choose one")
        expect(heading()).toBe("Choose how your agents run")
        expect(host!.textContent).toContain("No model can run your agent yet.")
        click(/^Continue/)
        expect(heading()).toBe("Create your first agent")
    })

    it("reports each completed step once, and never on the way back", () => {
        const onStepCompleted = vi.fn()
        render(baseProps({onStepCompleted}))
        answer(/^Engineering/)
        expect(onStepCompleted).toHaveBeenCalledOnce()
        click("Your work")
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
        click(/^New agent/)
        expect(host!.querySelector('[placeholder="Name your agent"]')).not.toBeNull()
    })

    it("opens a template on its own view on a phone, and Back returns to the list", () => {
        render(baseProps())
        toGallery()
        click(/^PR reviewer/)
        expect(nav.url).toBe(`${nav.BASE}/templates/pr-reviewer`)
        expect(button("Templates")).toBeTruthy()
        click("Templates")
        expect(nav.url).toBe(`${nav.BASE}/templates`)
        expect(() => button("Templates")).toThrow()
        click(/^New agent/)
        expect(nav.url).toBe(`${nav.BASE}/templates/scratch`)
        expect(host!.querySelector('[placeholder="Name your agent"]')).not.toBeNull()
        click("Templates")
        expect(nav.url).toBe(`${nav.BASE}/templates`)
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

    it("shows, routes, guards and reports a question added to the registry", () => {
        registerQuestion(TEAM_QUESTION)
        const onStepCompleted = vi.fn()
        const props = baseProps({onStepCompleted})
        render(props)
        expect(button("Your team").disabled).toBe(true)
        answer(/^Engineering/)
        answer(/^GitHub/)
        expect(heading()).toBe("How big is your team?")
        expect(nav.url).toBe(`${nav.BASE}/team`)
        act(() => nav.open(`${nav.BASE}/credits`))
        expect(heading()).toBe("How big is your team?")
        expect(nav.url).toBe(`${nav.BASE}/team`)
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", {key: "b"}))
        })
        act(() => vi.runOnlyPendingTimers())
        expect(heading()).toBe("500 credits, on us")
        expect(nav.url).toBe(`${nav.BASE}/credits`)
        const [step, draft] = onStepCompleted.mock.lastCall!
        expect(step).toBe("team")
        expect(stepIndex(step as OnboardingStep) + 1).toBe(3)
        expect(personProperties(draft.answers)).toEqual({
            user_role_v2: "Engineering",
            referral_source_v2: "GitHub",
            team_size_v1: "2 to 10",
        })
        render(props)
        click("Your team")
        expect(button(/^2 to 10/).getAttribute("aria-pressed")).toBe("true")
    })
})
