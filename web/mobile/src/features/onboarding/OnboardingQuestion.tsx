import {useEffect, useRef, useState} from "react"

import {FOCUS_RING} from "@/lib/interactive"
import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {CHOICE_KEYS, type OnboardingChoice} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"

/** A one-tap question: a chip or its letter key answers it, then the flow moves on. */
export const OnboardingQuestion = ({
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
    choices: readonly OnboardingChoice[]
    value: string | null
    onAnswer: (label: string) => void
    onAdvance: () => void
}) => {
    const {answerHoldMs} = useMotionPresets()
    const [picked, setPicked] = useState<string | null>(null)
    const pickedRef = useRef(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => clearTimeout(timerRef.current ?? undefined), [])

    const pickRef = useRef<(label: string) => void>(() => undefined)
    pickRef.current = (label: string) => {
        if (pickedRef.current) return
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
                <p className="text-muted-foreground m-0 text-[15px] leading-[22px]">{subtitle}</p>
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
                                "inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-lg border-0 pl-3.5 pr-4 text-sm font-medium transition-[background-color,color,opacity,box-shadow,scale] motion-reduce:transition-none",
                                FOCUS_RING,
                                active
                                    ? "bg-foreground text-background"
                                    : "bg-background text-foreground ring-foreground/10 hover:ring-foreground/30 shadow-xs ring-1",
                                picked !== null && (active ? "scale-[0.98]" : "opacity-45"),
                            )}
                        >
                            <Icon size={17} />
                            {label}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
