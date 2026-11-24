import {useState} from "react"

import {Button} from "@agenta/ui/ui"

const steps = ["Step 1 · Pick a model", "Step 2 · Add tools", "Step 3 · Write the prompt"]

/** A view swap for MOTION-01: animated (a fade and a 4px slide over duration-fast) or instant. */
export function MotionSwapDemo({animated}: {animated: boolean}) {
    const [i, setI] = useState(0)
    const [shown, setShown] = useState(true)
    const next = () => {
        if (!animated) return setI((v) => (v + 1) % steps.length)
        setShown(false)
        setTimeout(() => {
            setI((v) => (v + 1) % steps.length)
            setShown(true)
        }, 120)
    }
    return (
        <div className="flex flex-col items-center gap-3">
            <div
                className="rounded-lg bg-background px-4 py-3 text-label shadow-[inset_0_0_0_1px_var(--border-muted)] motion-reduce:transition-none"
                style={
                    animated
                        ? {transition: "opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)", opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(4px)"}
                        : undefined
                }
            >
                {steps[i]}
            </div>
            <Button variant="outline" onClick={next}>
                Next step
            </Button>
        </div>
    )
}
