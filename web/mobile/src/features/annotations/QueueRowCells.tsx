import {formatQueueReviewed, queueKindLabel, queueKindTone} from "@agenta/annotation"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {simpleQueueMolecule, type SimpleQueueTableRow} from "@agenta/entities/simpleQueue"
import {timeAgo} from "@agenta/shared/utils"
import {Badge, SkeletonBlock, type BadgeProps} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {QueueRowMenu} from "./QueueRowMenu"
import {QueueStatusBadge} from "./QueueStatusBadge"
import {useInView} from "./useInView"
import type {QueueToDelete} from "./useQueueDelete"

const NO_VALUE = "—"

/** "3d ago" for a timestamp, an em dash without one. The full date is the cell's tooltip. */
const dateLabel = (value: string | null | undefined) =>
    value ? timeAgo(Date.parse(value)) || NO_VALUE : NO_VALUE

const fullDate = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : undefined

/** The progress cell. It mounts only for a row in view: it costs one request per queue. */
const ReviewedCell = ({queueId}: {queueId: string}) => {
    const progress = useAtomValue(simpleQueueMolecule.selectors.scenarioProgress(queueId))
    if (!progress) return <SkeletonBlock active className="h-4 w-16 rounded" />
    return (
        <span className="block truncate text-[13px] text-muted-foreground">
            {formatQueueReviewed(progress)}
        </span>
    )
}

/** The live status, derived from the queue's scenarios. Same query as the progress cell. */
const LiveStatus = ({
    queueId,
    fallback,
}: {
    queueId: string
    fallback: string | null | undefined
}) => {
    const status = useAtomValue(simpleQueueMolecule.selectors.status(queueId))
    return <QueueStatusBadge status={status ?? fallback ?? "pending"} />
}

const TypeBadge = ({kind}: {kind: string | null | undefined}) => {
    const label = queueKindLabel(kind)
    if (!label) return <span className="text-[13px] text-placeholder">{NO_VALUE}</span>
    // The tone names are badge colors (blue, green, purple, orange) or "default".
    return <Badge variant={queueKindTone(kind) as BadgeProps["variant"]}>{label}</Badge>
}

const CreatedBy = ({userId}: {userId: string | null | undefined}) =>
    userId ? (
        <UserAuthorLabel userId={userId} showAvatar className="text-[13px] text-muted-foreground" />
    ) : (
        <span className="text-[13px] text-muted-foreground">{NO_VALUE}</span>
    )

/**
 * One queue's cells, in column order.
 *
 * A phone has only four columns, so the type, description, dates and creator go on a second
 * line under the name instead of being dropped.
 */
export const QueueRowCells = ({
    row,
    narrow,
    canDelete,
    onOpen,
    onDelete,
}: {
    row: SimpleQueueTableRow
    narrow: boolean
    canDelete: boolean
    onOpen: (row: SimpleQueueTableRow) => void
    onDelete: (queue: QueueToDelete) => void
}) => {
    // One observer per row: the progress and the status read the same query, so they start
    // together.
    const {ref, inView} = useInView<HTMLSpanElement>()
    const name = row.name?.trim() || "Untitled"
    const description = row.description?.trim()

    return (
        <>
            <span ref={ref} className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[14px] font-medium leading-[18px]" title={name}>
                    {name}
                </span>
                {narrow ? (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                        <TypeBadge kind={row.data?.kind} />
                        <span>{dateLabel(row.updated_at)}</span>
                        <CreatedBy userId={row.created_by_id} />
                        {description ? (
                            <span className="w-full truncate" title={description}>
                                {description}
                            </span>
                        ) : null}
                    </span>
                ) : null}
            </span>

            {narrow ? null : (
                <span className="flex">
                    <TypeBadge kind={row.data?.kind} />
                </span>
            )}

            <span className="block min-w-0">
                {inView ? (
                    <ReviewedCell queueId={row.id} />
                ) : (
                    <SkeletonBlock active className="h-4 w-16 rounded" />
                )}
            </span>

            <span className="flex">
                {inView ? (
                    <LiveStatus queueId={row.id} fallback={row.status} />
                ) : (
                    <QueueStatusBadge status={row.status} />
                )}
            </span>

            {narrow ? null : (
                <>
                    <span
                        className="block truncate text-[13px] text-muted-foreground"
                        title={description || undefined}
                    >
                        {description || NO_VALUE}
                    </span>
                    <span
                        className="block truncate text-[13px] text-muted-foreground"
                        title={fullDate(row.updated_at)}
                    >
                        {dateLabel(row.updated_at)}
                    </span>
                    <span
                        className="block truncate text-[13px] text-muted-foreground"
                        title={fullDate(row.created_at)}
                    >
                        {dateLabel(row.created_at)}
                    </span>
                    <span className="flex min-w-0">
                        <CreatedBy userId={row.created_by_id} />
                    </span>
                </>
            )}

            {/* The menu's own clicks are not the row's: without this every press would also open
                the queue. */}
            <span
                className="flex justify-end"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                <QueueRowMenu
                    queue={{id: row.id, name: row.name}}
                    canDelete={canDelete}
                    onOpen={() => onOpen(row)}
                    onDelete={onDelete}
                />
            </span>
        </>
    )
}
