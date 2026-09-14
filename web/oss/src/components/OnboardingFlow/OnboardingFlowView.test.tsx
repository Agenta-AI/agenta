import {fireEvent, render, screen, cleanup} from "@testing-library/react"
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    AGENT_TEMPLATES: [
        {
            key: "review",
            name: "PR reviewer",
            category: "Engineering",
            description: "Review changes",
            overview: "Review open pull requests",
            example: {
                prompt: "Review my pull requests",
                steps: ["Read the diff"],
                reply: "Review complete",
            },
        },
    ],
    templateBuilderMessage: () => "Set up a PR reviewer and review my open pull requests.",
}))

import {firstAgentInput} from "./choices"
import OnboardingFlowView from "./OnboardingFlowView"

beforeAll(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    )
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn(() => ({
            matches: false,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })),
    })
})
afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
})
const setup = (variant: "control" | "task-first" = "control", modelReady = true) => {
    const onCreate = vi.fn()
    render(
        <OnboardingFlowView
            variant={variant}
            tools={<p>Tools</p>}
            model={<p>Models</p>}
            modelReady={modelReady}
            committing={false}
            onCreate={onCreate}
            onStep={vi.fn()}
        />,
    )
    fireEvent.click(screen.getByRole("button", {name: "Engineering"}))
    fireEvent.click(screen.getByRole("button", {name: "Next"}))
    fireEvent.click(screen.getByRole("button", {name: "GitHub"}))
    fireEvent.click(screen.getByRole("button", {name: "Next"}))
    fireEvent.click(screen.getByRole("button", {name: "Continue"}))
    return onCreate
}

describe("first agent onboarding", () => {
    it("preserves answers and the current step across a redirect remount", () => {
        const props = {
            draftKey: "onboarding:project-a",
            variant: "control" as const,
            tools: <p>Tools</p>,
            model: <p>Models</p>,
            modelReady: true,
            committing: false,
            onCreate: vi.fn(),
            onStep: vi.fn(),
        }
        const first = render(<OnboardingFlowView {...props} />)
        fireEvent.click(screen.getByRole("button", {name: "Engineering"}))
        fireEvent.click(screen.getByRole("button", {name: "Next"}))
        fireEvent.click(screen.getByRole("button", {name: "GitHub"}))
        fireEvent.click(screen.getByRole("button", {name: "Next"}))
        first.unmount()
        const second = render(<OnboardingFlowView {...props} />)
        expect(screen.getByRole("heading", {name: "Connect your tools"})).toBeTruthy()
        fireEvent.click(screen.getByRole("button", {name: "Continue"}))
        fireEvent.click(screen.getByRole("button", {name: "Next"}))
        fireEvent.change(screen.getByLabelText("Agent name"), {target: {value: "My agent"}})
        fireEvent.change(screen.getByLabelText("What would you like it to do?"), {
            target: {value: "Help me plan"},
        })
        second.unmount()
        const third = render(<OnboardingFlowView {...props} />)
        fireEvent.click(screen.getByRole("button", {name: "Create agent"}))
        expect(props.onCreate).toHaveBeenCalledWith({name: "My agent", seedMessage: "Help me plan"})
        third.unmount()
        render(<OnboardingFlowView {...props} draftKey="onboarding:project-b" />)
        expect(screen.getByRole("heading", {name: "What kind of work do you do?"})).toBeTruthy()
    })

    it("requires a runnable model before proceeding", () => {
        setup("control", false)
        expect(screen.getByRole("button", {name: "Next"}).hasAttribute("disabled")).toBe(true)
    })
    it("creates A with the edited name and the selected template's first message", () => {
        const onCreate = setup()
        fireEvent.click(screen.getByRole("button", {name: "Next"}))
        expect(screen.getByRole("button", {name: "Create agent"}).hasAttribute("disabled")).toBe(
            true,
        )
        fireEvent.click(screen.getByRole("button", {name: /PR reviewer/}))
        fireEvent.change(screen.getByLabelText("Agent name"), {target: {value: "My reviewer"}})
        fireEvent.click(screen.getByRole("button", {name: "Create agent"}))
        expect(onCreate).toHaveBeenCalledWith({
            name: "My reviewer",
            seedMessage: "Set up a PR reviewer and review my open pull requests.",
        })
    })
    it("labels B examples and creates with the task's builder message", () => {
        const onCreate = setup("task-first")
        fireEvent.click(screen.getByRole("button", {name: "Next"}))
        fireEvent.click(screen.getByRole("button", {name: /Review my pull requests/}))
        expect(screen.getByText("Illustration only. Your agent hasn't run yet.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", {name: "Create agent"}))
        expect(onCreate).toHaveBeenCalledWith({
            name: "PR reviewer",
            seedMessage: "Set up a PR reviewer and review my open pull requests.",
        })
    })
    it("clears template selection when the role changes", () => {
        setup()
        fireEvent.click(screen.getByRole("button", {name: "Next"}))
        fireEvent.click(screen.getByRole("button", {name: /PR reviewer/}))
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", {name: "Back"}))
        fireEvent.click(screen.getByRole("button", {name: "Sales"}))
        for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole("button", {name: "Next"}))
        fireEvent.click(screen.getByRole("button", {name: "Continue"}))
        fireEvent.click(screen.getByRole("button", {name: "Next"}))
        expect(screen.queryByRole("button", {name: /PR reviewer/})).toBeNull()
        expect(screen.getByRole("button", {name: "Create agent"}).hasAttribute("disabled")).toBe(
            true,
        )
    })
    it("does not record a completed step when going back", () => {
        const onStep = vi.fn()
        render(
            <OnboardingFlowView
                variant="control"
                tools={null}
                model={null}
                modelReady
                committing={false}
                onCreate={vi.fn()}
                onStep={onStep}
            />,
        )
        fireEvent.click(screen.getByRole("button", {name: "Engineering"}))
        fireEvent.click(screen.getByRole("button", {name: "Next"}))
        expect(onStep).toHaveBeenCalledOnce()
        fireEvent.click(screen.getByRole("button", {name: "Back"}))
        expect(onStep).toHaveBeenCalledOnce()
    })
    it("rejects blank input and trims custom tasks", () => {
        expect(firstAgentInput("control", " ", "do this", null)).toBeNull()
        expect(firstAgentInput("task-first", "", "  ", null)).toBeNull()
        expect(firstAgentInput("task-first", "", " Plan my week ", null)).toEqual({
            name: "My first agent",
            seedMessage: "Plan my week",
        })
    })
})
