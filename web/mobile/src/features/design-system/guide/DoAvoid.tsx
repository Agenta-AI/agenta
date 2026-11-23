import {CheckIcon, XIcon} from "@phosphor-icons/react"
import type {ReactNode} from "react"

interface DoAvoidProps {
    kind: "do" | "avoid"
    example: ReactNode
    caption: string
}

export function DoAvoid({kind, example, caption}: DoAvoidProps) {
    const isDo = kind === "do"
    return (
        <figure className="m-0 flex min-w-0 flex-col gap-2">
            <div className="flex min-h-40 items-center justify-center rounded-lg bg-muted p-6 shadow-[inset_0_0_0_1px_var(--border-muted)]">
                {example}
            </div>
            <figcaption className="flex gap-2 text-label">
                <span
                    className={`inline-flex shrink-0 items-center gap-1 ${isDo ? "text-success" : "text-destructive"}`}
                >
                    {isDo ? <CheckIcon aria-hidden /> : <XIcon aria-hidden />}
                    {isDo ? "Do" : "Avoid"}
                </span>
                <span className="font-normal text-muted-foreground">{caption}</span>
            </figcaption>
        </figure>
    )
}
