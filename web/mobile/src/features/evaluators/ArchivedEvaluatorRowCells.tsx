import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {evaluatorTemplatesDataAtom} from "@agenta/entities/workflow"
import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {useAtomValue} from "jotai"

import {formatDay} from "../archived-apps/archivedAppsView"

import {EvaluatorKeyTags} from "./EvaluatorKeyTags"
import {EvaluatorRowMenu} from "./EvaluatorRowMenu"
import type {EvaluatorArchivedRow} from "./evaluatorsView"

const TemplateTags = ({evaluatorKey}: {evaluatorKey: string | null}) => {
    const templates = useAtomValue(evaluatorTemplatesDataAtom)
    const template = evaluatorKey ? templates.find((entry) => entry.key === evaluatorKey) : null
    return <EvaluatorKeyTags names={template?.categories ?? []} />
}

/** One archived evaluator's cells, in column order. */
export const ArchivedEvaluatorRowCells = ({
    row,
    category,
    narrow,
    onOpen,
    onRestore,
    restoring,
}: {
    row: EvaluatorArchivedRow
    category: EvaluatorCategory
    /** A phone shows the name and the archive date only. */
    narrow: boolean
    onOpen: () => void
    /** Absent without `edit_evaluators`. */
    onRestore?: () => void
    restoring: boolean
}) => {
    const automatic = category === "automatic"
    const name = row.name ?? "—"

    return (
        <>
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
            <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
                {formatDay(row.archivedAt)}
            </span>
            {narrow ? null : (
                <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
                    <UserAuthorLabel
                        userId={row.archivedById}
                        showYouLabel
                        showAvatar
                        fallback="—"
                    />
                </span>
            )}
            {narrow || !automatic ? null : (
                <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
                    {row.message ?? "—"}
                </span>
            )}
            <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                <EvaluatorRowMenu
                    copy={{revisionId: row.id, slug: row.slug}}
                    onOpen={onOpen}
                    openLabel="Open details"
                    onRestore={onRestore}
                    restoring={restoring}
                />
            </span>
        </>
    )
}
