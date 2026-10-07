import {useEffect, useRef, useState} from "react"

import {Kbd} from "@agenta/ui/ui"
import {useIsPresent} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {CHOICE_KEYS, type OnboardingChoice} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"

/** A one-tap question: a chip or its letter key answers it, then the flow moves on. */
export const OnboardingQuestion = <Label extends string>({
    headingId,
    title,
    subtitle,
    choices,
    value,
    onAnswer,
    onAdvance,
}: {
    headingId: string
    title: string
    subtitle: string
    choices: readonly OnboardingChoice<Label>[]
    value: Label | null
    onAnswer: (label: Label) => void
    onAdvance: () => void
}) => {
    const {answerHoldMs} = useMotionPresets()
    const [picked, setPicked] = useState<Label | null>(null)
    const pickedRef = useRef(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // A question that is leaving the screen stays mounted while it animates out; it must not act.
    const present = useIsPresent()
    useEffect(() => {
        if (!present) {
            clearTimeout(timerRef.current ?? undefined)
            return
        }
        // Back can bring the same question back before its exit finished; it must answer again.
        pickedRef.current = false
        setPicked(null)
    }, [present])
    useEffect(() => () => clearTimeout(timerRef.current ?? undefined), [])

    const pickRef = useRef<(label: Label) => void>(() => undefined)
    pickRef.current = (label: Label) => {
        if (pickedRef.current || !present) return
        pickedRef.current = true
        setPicked(label)
        onAnswer(label)
        timerRef.current = setTimeout(onAdvance, answerHoldMs)
    }

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest("input, textarea, [contenteditable=true]")) return
            const index = CHOICE_KEYS.indexOf(event.key.toUpperCase())
            if (event.key.length !== 1 || index < 0 || index >= choices.length) return
            event.preventDefault()
            pickRef.current(choices[index].label)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [choices])

    const selected = picked ?? value
    return (
        <div className="flex flex-col gap-7">
            <div className="flex flex-col gap-1.5">
                <h1 id={headingId} tabIndex={-1} className={ONBOARDING_COPY.headingClass}>
                    {title}
                </h1>
                <p className="text-muted-foreground m-0 text-[15px]">{subtitle}</p>
            </div>
            <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2">
                {choices.map(({label, icon: Icon}, index) => {
                    const active = selected === label
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
                                "inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-solid pl-3.5 pr-2.5 text-sm font-medium transition-[background-color,color,opacity]",
                                FOCUS_RING,
                                active
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-border bg-background text-foreground hover:bg-accent",
                                picked !== null && !active && "opacity-45",
                            )}
                        >
                            <Icon size={17} weight={active ? "fill" : "regular"} />
                            {label}
                            <Kbd
                                aria-hidden
                                tone={active ? "inverse" : "chip"}
                                className="ml-1 max-lg:hidden"
                            >
                                {key}
                            </Kbd>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
