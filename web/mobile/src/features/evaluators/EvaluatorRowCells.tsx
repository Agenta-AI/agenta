import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {evaluatorTemplatesDataAtom} from "@agenta/entities/workflow"
import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {Checkbox} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {formatDay} from "../archived-apps/archivedAppsView"

import {EvaluatorKeyTags} from "./EvaluatorKeyTags"
import {EvaluatorRowMenu} from "./EvaluatorRowMenu"
import type {EvaluatorRevisionRow} from "./evaluatorsView"
import {useEvaluatorOverviewHref} from "./useEvaluatorOverviewHref"

/** The template categories of an automatic evaluator. Reads the catalog, so only this tab pays. */
const TemplateTags = ({evaluatorKey}: {evaluatorKey: string | null}) => {
    const templates = useAtomValue(evaluatorTemplatesDataAtom)
    const template = evaluatorKey ? templates.find((entry) => entry.key === evaluatorKey) : null
    return <EvaluatorKeyTags names={template?.categories ?? []} />
}

const Muted = ({children}: {children: React.ReactNode}) => (
    <span className="block min-w-0 truncate text-[13px] text-muted-foreground">{children}</span>
)

/** One revision's cells, in column order. */
export const EvaluatorRowCells = ({
    row,
    category,
    narrow,
    selectable,
    selected,
    onToggle,
    onOpen,
    onArchive,
}: {
    row: EvaluatorRevisionRow
    category: EvaluatorCategory
    /** A phone shows the name and the last change only. */
    narrow: boolean
    /** Selecting needs `edit_evaluators`; without it the row has no checkbox. */
    selectable: boolean
    selected: boolean
    onToggle: () => void
    onOpen: () => void
    /** Absent without `edit_evaluators`. */
    onArchive?: () => void
}) => {
    const automatic = category === "automatic"
    const name = row.name ?? "—"
    const overviewHref = useEvaluatorOverviewHref(row.workflowId)

    return (
        <>
            {selectable ? (
                // The row opens on a click; the checkbox must not.
                <span className="flex" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                        checked={selected}
                        onCheckedChange={onToggle}
                        aria-label={`Select ${name}`}
                    />
                </span>
            ) : null}
            <span className="flex min-w-0 items-center gap-2">
                <span
                    className="truncate text-[14px] font-medium leading-[18px] text-foreground"
                    title={name}
                >
                    {name}
                </span>
                {row.version != null ? (
                    <span className="shrink-0 rounded-sm bg-muted px-1.5 text-[12px] leading-5 text-muted-foreground">
                        v{row.version}
                    </span>
                ) : null}
            </span>

            {narrow || !automatic ? null : (
                <span className="flex min-w-0">
                    <WorkflowTypeTag isEvaluator workflowKey={row.evaluatorKey} />
                </span>
            )}
            {narrow ? null : automatic ? (
                <TemplateTags evaluatorKey={row.evaluatorKey} />
            ) : (
                <EvaluatorKeyTags names={row.feedbackKeys} />
            )}
            {narrow ? null : <Muted>{formatDay(row.createdAt)}</Muted>}
            <Muted>{formatDay(row.updatedAt)}</Muted>
            {narrow ? null : (
                <Muted>
                    <UserAuthorLabel
                        userId={row.updatedById}
                        showYouLabel
                        showAvatar
                        fallback="—"
                    />
                </Muted>
            )}
            {narrow || !automatic ? null : <Muted>{row.message ?? "—"}</Muted>}

            <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                <EvaluatorRowMenu
                    copy={{revisionId: row.id, slug: row.slug}}
                    // Editing a human evaluator comes later: its row menu has no Configure.
                    onOpen={automatic ? onOpen : undefined}
                    openLabel="Configure"
                    overviewHref={automatic ? overviewHref : null}
                    onArchive={onArchive}
                />
            </span>
        </>
    )
}
