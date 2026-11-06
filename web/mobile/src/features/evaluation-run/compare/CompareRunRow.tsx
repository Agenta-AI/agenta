import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import Link from "next/link"

import {RunStatusTag} from "../overview/RunStatusTag"

const createdLabel = (value: string | null | undefined) =>
    value
        ? new Date(value).toLocaleDateString(undefined, {
              day: "2-digit",
              month: "short",
              year: "numeric",
          })
        : null

/** One run the base run can be compared with: its name, description, status and date. */
export const CompareRunRow = ({run, href}: {run: EvaluationRun; href: string}) => {
    const created = createdLabel(run.created_at)
    return (
        <Link
            href={href}
            prefetch={false}
            className="flex items-start justify-between gap-3 rounded-md px-2 py-2 text-foreground no-underline hover:bg-muted"
        >
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm">{run.name?.trim() || "Untitled run"}</span>
                <span className="truncate text-xs text-muted-foreground">
                    {run.description?.trim() || "No description"}
                </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
                <RunStatusTag status={run.status ?? null} />
                {created ? <span className="text-xs text-muted-foreground">{created}</span> : null}
            </span>
        </Link>
    )
}
