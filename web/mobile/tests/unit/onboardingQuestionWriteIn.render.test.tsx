// @vitest-environment jsdom
import {act, useState} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("motion/react", () => ({useReducedMotion: () => true}))

vi.mock("@agenta/ui/ui", () => ({
    Button: ({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props}>{children}</button>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

import type {OnboardingChoice} from "@/features/onboarding/onboardingChoices"
import {OnboardingQuestion} from "@/features/onboarding/OnboardingQuestion"
import type {OnboardingAnswer} from "@/features/onboarding/onboardingQuestions"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const CHOICES: OnboardingChoice[] = [
    {label: "Engineer"},
    {label: "Designer"},
    {label: "Other", text: true},
] as OnboardingChoice[]

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
})

/** Renders the question with a saved answer, as a reload restores it from the draft. */
const renderRestored = (saved: OnboardingAnswer) => {
    const answers: (OnboardingAnswer | undefined)[] = []
    const Harness = () => {
        const [value, setValue] = useState<OnboardingAnswer | undefined>(saved)
        answers.push(value)
        return (
            <OnboardingQuestion
                headingId="role"
                title="What is your role?"
                subtitle="Pick one."
                choices={CHOICES}
                value={value}
                onAnswer={setValue}
                onAdvance={() => undefined}
            />
        )
    }
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<Harness />))
    return {latest: () => answers[answers.length - 1]}
}

const writeInBox = () => host!.querySelector<HTMLInputElement>("#onboarding-other")

const typeInto = (input: HTMLInputElement, text: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    act(() => {
        setter.call(input, text)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

describe("OnboardingQuestion write-in after a reload", () => {
    it("keeps the box open when the restored text is cleared", () => {
        const view = renderRestored("Other: consultant")
        expect(writeInBox()?.value).toBe("consultant")

        typeInto(writeInBox()!, "")

        expect(writeInBox()).not.toBeNull()
        expect(view.latest()).toEqual([])
        const other = Array.from(host!.querySelectorAll("button")).find(
            (button) => button.textContent === "Other",
        )
        expect(other?.getAttribute("aria-pressed")).toBe("true")
    })

    it("does not let a letter key pick another choice while the box is open", () => {
        const view = renderRestored("Other: consultant")
        typeInto(writeInBox()!, "")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", {key: "a"}))
        })

        expect(view.latest()).toEqual([])
        expect(writeInBox()).not.toBeNull()
    })
})
