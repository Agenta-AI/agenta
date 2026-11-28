import {scenarioStatusLabel, scenarioStatusTone} from "@agenta/annotation"
import clsx from "clsx"

import {RUN_STATUS_DOT_COLOR, RUN_STATUS_TEXT_COLOR} from "../../evaluations/list/runStatusDotColor"

/**
 * A scenario status in a table row: a success is a dot only, with the word in the title; every
 * other status is a dot and its word, so the rare problems stand out.
 */
export const ScenarioStatusDot = ({
    status,
    title,
}: {
    status: string | null
    /** More about the status, such as the error of a step no column shows. */
    title?: string
}) => {
    if (!status) return <span className="text-muted-foreground">—</span>
    const tone = scenarioStatusTone(status)
    const word = scenarioStatusLabel(status)
    return (
        <span
            title={title ? `${word}: ${title}` : word}
            className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
        >
            <span
                aria-hidden
                className={clsx(
                    "size-2 shrink-0 rounded-round",
                    RUN_STATUS_DOT_COLOR[tone],
                    tone === "processing" && "animate-pulse",
                )}
            />
            <span
                className={clsx(
                    "truncate text-meta font-medium",
                    RUN_STATUS_TEXT_COLOR[tone],
                    tone === "success" && "sr-only",
                )}
            >
                {word}
            </span>
        </span>
    )
}
