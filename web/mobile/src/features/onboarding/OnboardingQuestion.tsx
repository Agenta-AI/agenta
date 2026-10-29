import {useEffect, useRef, useState} from "react"

import {Button, Input} from "@agenta/ui/ui"
import {ArrowRight} from "@phosphor-icons/react"

import {FOCUS_RING} from "@/lib/interactive"
import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {CHOICE_KEYS, type OnboardingChoice} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {
    answerLabels,
    WRITE_IN_MAX,
    writeInAnswer,
    writeInText,
    type OnboardingAnswer,
} from "./onboardingQuestions"

/**
 * A chip question. One-tap: a chip or its letter key answers it, then the flow moves on.
 * Multiple: chips and keys toggle, and Continue (or Enter) moves on.
 * A choice with `text` (Other) asks for one line: the answer is "Other: the line", and the
 * step counts as answered only once the line is there.
 */
export const OnboardingQuestion = ({
    headingId,
    title,
    subtitle,
    choices,
    multiple = false,
    value,
    onAnswer,
    onAdvance,
}: {
    headingId: string
    title: string
    subtitle: string
    choices: readonly OnboardingChoice[]
    multiple?: boolean
    value: OnboardingAnswer | undefined
    onAnswer: (answer: OnboardingAnswer) => void
    onAdvance: () => void
}) => {
    const {answerHoldMs} = useMotionPresets()
    const [picked, setPicked] = useState<string | null>(null)
    const pickedRef = useRef(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => clearTimeout(timerRef.current ?? undefined), [])

    const labels = answerLabels(value)
    const asText = typeof value === "string" ? value : ""
    // A write-in in progress, or one restored from the draft on a reload.
    const [writing, setWriting] = useState<string | null>(null)
    const writingChoice =
        choices.find((choice) => choice.text && choice.label === writing) ??
        choices.find((choice) => choice.text && writeInText(choice.label, asText) !== null)
    const writeIn = writingChoice?.label ?? null
    // The raw line as typed; the stored answer is trimmed, so it cannot drive the input.
    const [draftLine, setDraftLine] = useState<string | null>(null)
    const typed = writeIn ? (draftLine ?? writeInText(writeIn, asText) ?? "") : ""

    const pickRef = useRef<(label: string) => void>(() => undefined)
    pickRef.current = (label: string) => {
        if (multiple) {
            const on = (item: string) => (item === label) !== labels.includes(item)
            onAnswer(choices.map((choice) => choice.label).filter(on))
            return
        }
        // A write-in choice never advances on its own: it waits for the line.
        if (choices.find((choice) => choice.label === label)?.text) {
            // Tapping the open write-in again keeps its line.
            if (writeIn === label) return
            // A chip picked a moment ago must not advance past the line about to be typed.
            clearTimeout(timerRef.current ?? undefined)
            timerRef.current = null
            pickedRef.current = false
            setPicked(null)
            setWriting(label)
            if (labels.length > 0) onAnswer([])
            return
        }
        if (pickedRef.current) return
        pickedRef.current = true
        setWriting(null)
        setDraftLine(null)
        setPicked(label)
        onAnswer(label)
        timerRef.current = setTimeout(onAdvance, answerHoldMs)
    }

    const write = (text: string) => {
        if (!writeIn) return
        setDraftLine(text)
        onAnswer(text.trim() ? writeInAnswer(writeIn, text) : [])
    }

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest("input, textarea, [contenteditable=true]")) return
            if (event.key === "Enter") {
                if (!multiple || target?.closest("button, a")) return
                event.preventDefault()
                continueRef.current()
                return
            }
            const index = CHOICE_KEYS.indexOf(event.key.toUpperCase())
            if (event.key.length !== 1 || index < 0 || index >= choices.length) return
            event.preventDefault()
            pickRef.current(choices[index].label)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [choices, multiple])

    const continueRef = useRef<() => void>(() => undefined)
    continueRef.current = () => {
        if (labels.length > 0) onAdvance()
    }

    const isActive = (label: string) =>
        multiple ? labels.includes(label) : (writeIn ?? picked ?? labels[0]) === label

    return (
        <div className="flex flex-col gap-7">
            <div className="flex flex-col gap-1.5">
                <h1 id={headingId} tabIndex={-1} className={ONBOARDING_COPY.headingClass}>
                    {title}
                </h1>
                <p className="text-muted-foreground m-0 text-[15px] leading-[22px]">{subtitle}</p>
            </div>
            <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2">
                {choices.map(({label, icon: Icon}, index) => {
                    const active = isActive(label)
                    const key = CHOICE_KEYS[index]
                    return (
                        <button
                            type="button"
                            key={label}
                            aria-pressed={active}
                            aria-keyshortcuts={key}
                            title={ONBOARDING_COPY.keyHint(key)}
                            onClick={() => pickRef.current(label)}
                            className={cn(
                                "inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-lg border-0 pl-3.5 pr-4 text-sm font-medium transition-[background-color,color,opacity,box-shadow,scale] motion-reduce:transition-none",
                                FOCUS_RING,
                                active
                                    ? "bg-foreground text-background"
                                    : "bg-background text-foreground ring-foreground/10 hover:ring-foreground/30 shadow-xs ring-1",
                                picked !== null && (active ? "scale-[0.98]" : "opacity-45"),
                            )}
                        >
                            {Icon ? <Icon size={17} /> : null}
                            {label}
                        </button>
                    )
                })}
            </div>
            {writeIn ? (
                <div className="flex flex-col gap-2">
                    <label
                        className="text-[13px] font-medium leading-[18px]"
                        htmlFor="onboarding-other"
                    >
                        {ONBOARDING_COPY.writeIn}
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                            id="onboarding-other"
                            autoFocus
                            value={typed}
                            maxLength={WRITE_IN_MAX}
                            placeholder={ONBOARDING_COPY.writeInPlaceholder}
                            aria-label={ONBOARDING_COPY.writeIn}
                            onChange={(event) => write(event.target.value)}
                            onKeyDown={(event) => {
                                // Enter that confirms an IME candidate is not a submit.
                                if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                                event.preventDefault()
                                continueRef.current()
                            }}
                            className="h-9 sm:max-w-[420px]"
                        />
                        <Button
                            onClick={() => continueRef.current()}
                            disabled={typed.trim().length === 0}
                            className="max-sm:h-11 max-sm:w-full"
                        >
                            {ONBOARDING_COPY.continue}
                            <ArrowRight data-icon="inline-end" />
                        </Button>
                    </div>
                </div>
            ) : multiple ? (
                <div className="flex justify-end">
                    <Button
                        onClick={() => continueRef.current()}
                        disabled={labels.length === 0}
                        className="max-sm:h-11 max-sm:w-full"
                    >
                        {ONBOARDING_COPY.continue}
                        <ArrowRight data-icon="inline-end" />
                    </Button>
                </div>
            ) : null}
        </div>
    )
}
