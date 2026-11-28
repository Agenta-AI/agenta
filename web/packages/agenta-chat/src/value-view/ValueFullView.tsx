import {useId, useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {detectValueShape} from "@agenta/shared/utils"
import {cn, Segmented} from "@agenta/ui/ui"

import {CopyValueButton, valueAsText} from "./CopyValueButton"
import type {TurnActivity} from "./MessagesValue"
import {ValueBody} from "./ValueField"

/** The two modes of a full view. */
export type ValueViewMode = "formatted" | "raw"

/** Shapes whose Raw text is the same as what Formatted draws: no switch for them. */
const PLAIN_SHAPES = new Set(["empty", "boolean", "number", "url", "text-short", "text-long"])

export interface ValueFullViewProps {
    value: unknown
    /** The field's name, in the header. */
    label?: string
    defaultMode?: ValueViewMode
    className?: string
    /**
     * The trace's tool steps per user exchange, drawn as `ValueField` draws them; Raw still shows
     * the stored value only.
     */
    turnActivity?: readonly TurnActivity[]
}

/**
 * One field alone at full height: every level open, every line shown, with copy and, where the
 * drawing differs from the stored text, Formatted and Raw. Raw shows the original string of a
 * value written as text.
 */
export const ValueFullView = ({
    value,
    label,
    defaultMode = "formatted",
    className,
    turnActivity,
}: ValueFullViewProps) => {
    const t = useT(valueViewCatalog)
    const stateKey = useId()
    const [mode, setMode] = useState<ValueViewMode>(defaultMode)
    const detected = useMemo(() => detectValueShape(value), [value])
    const switchable = detected.parsedFromText || !PLAIN_SHAPES.has(detected.shape)
    const raw = mode === "raw" && switchable

    return (
        <div
            className={cn(
                "flex min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-background",
                className,
            )}
        >
            <div className="flex min-h-10 items-center gap-2 border-0 border-b border-solid border-border-muted px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-code-sm text-muted-foreground">
                    {label}
                </span>
                {switchable ? (
                    <Segmented
                        size="sm"
                        value={mode}
                        onChange={(next) => setMode(next as ValueViewMode)}
                        options={[
                            {value: "formatted", label: t("chat.valueView.formatted")},
                            {value: "raw", label: t("chat.valueView.raw")},
                        ]}
                    />
                ) : null}
                <CopyValueButton value={value} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3 text-body-sm">
                {raw ? (
                    <pre className="m-0 whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 font-mono text-code">
                        {valueAsText(value)}
                    </pre>
                ) : (
                    <ValueBody
                        value={value}
                        unfolded
                        stateKey={stateKey}
                        turnActivity={turnActivity}
                    />
                )}
            </div>
        </div>
    )
}
