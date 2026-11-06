import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {evaluatorTemplatesDataAtom} from "@agenta/entities/workflow"
import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {cn} from "@agenta/ui/styles"
import {Spinner} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {formatDay} from "../archived-apps/archivedAppsView"

import {EvaluatorKeyTags} from "./EvaluatorKeyTags"
import {EvaluatorRowMenu} from "./EvaluatorRowMenu"
import type {EvaluatorListRow} from "./evaluatorsView"
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

/** One row's cells, in column order: an evaluator, or an older revision under it. */
export const EvaluatorRowCells = ({
    row,
    category,
    narrow,
    canEdit,
    expanded,
    loadingOlder,
    onToggleExpand,
    onOpen,
    onArchive,
}: {
    row: EvaluatorListRow
    category: EvaluatorCategory
    /** A phone shows the name and the last change only. */
    narrow: boolean
    /** The reader may edit evaluators: a human row offers Edit, else Open details. */
    canEdit: boolean
    expanded: boolean
    loadingOlder: boolean
    onToggleExpand: () => void
    onOpen: () => void
    /** Absent without `edit_evaluators`, and on an older revision. */
    onArchive?: () => void
}) => {
    const automatic = category === "automatic"
    const name = row.name ?? "—"
    const overviewHref = useEvaluatorOverviewHref(row.workflowId)
    const older = row.depth === 1

    return (
        <>
            <span className={cn("flex min-w-0 items-center gap-1.5", older && "pl-7")}>
                {older ? null : row.hasOlder ? (
                    // The row opens on a click; the expand must not.
                    <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} older versions of ${name}`}
                        onClick={(event) => {
                            event.stopPropagation()
                            onToggleExpand()
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-colorFillTertiary hover:text-foreground"
                    >
                        {loadingOlder ? (
                            <Spinner size="small" />
                        ) : (
                            <CaretRight
                                size={12}
                                aria-hidden
                                className={cn("transition-transform", expanded && "rotate-90")}
                            />
                        )}
                    </button>
                ) : (
                    <span className="size-6 shrink-0" aria-hidden />
                )}
                <span
                    className={cn(
                        "truncate text-[14px] leading-[18px]",
                        older ? "text-muted-foreground" : "font-medium text-foreground",
                    )}
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
                    onOpen={onOpen}
                    openLabel={
                        automatic
                            ? "Configure"
                            : canEdit && row.depth === 0
                              ? "Edit"
                              : "Open details"
                    }
                    overviewHref={automatic ? overviewHref : null}
                    onArchive={onArchive}
                />
            </span>
        </>
    )
}
