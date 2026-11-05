import {UserAuthorLabel} from "@agenta/entities/shared"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {FormattedDate} from "@agenta/ui/components/presentational"

import type {AppRevisionRow} from "./useAppRevisions"
import {VariantRowMenu} from "./VariantRowMenu"

/** One revision's cells, in column order. A phone has no Model, Created by or Notes cell. */
export const VariantRowCells = ({
    row,
    narrow,
    isLatest,
    canDeploy,
    canDelete,
    playgroundHref,
    onOpen,
    onDeploy,
    onDelete,
}: {
    row: AppRevisionRow
    narrow: boolean
    isLatest: boolean
    canDeploy: boolean
    canDelete: boolean
    playgroundHref: ((row: AppRevisionRow) => string) | null
    onOpen: (row: AppRevisionRow) => void
    onDeploy: (row: AppRevisionRow) => void
    onDelete: (row: AppRevisionRow) => void
}) => (
    <>
        <span className="block min-w-0 truncate text-[14px] font-medium text-foreground">
            <VariantDetailsWithStatus
                variant={{id: row.revisionId}}
                variantName={row.variantName}
                revision={row.version}
                isLatest={isLatest && !narrow}
                showBadges
                showRevisionAsTag
                hideDiscard
                showStable
            />
        </span>
        {narrow ? null : (
            <span className="block truncate text-[13px] text-muted-foreground">
                {row.model || "—"}
            </span>
        )}
        <span className="block truncate text-[13px] text-muted-foreground">
            <FormattedDate date={row.createdAt} format="MMM D, YYYY" fallback="—" />
        </span>
        {narrow ? null : (
            <span className="block truncate text-[13px] text-muted-foreground">
                <UserAuthorLabel userId={row.createdById} showYouLabel fallback="—" />
            </span>
        )}
        {narrow ? null : (
            <span
                className="block truncate text-[13px] text-muted-foreground"
                title={row.message ?? undefined}
            >
                {row.message || "—"}
            </span>
        )}
        {/* The menu's own clicks are not the row's: without this each press also opens the drawer. */}
        <span
            className="flex justify-end"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <VariantRowMenu
                row={row}
                canDeploy={canDeploy}
                canDelete={canDelete}
                playgroundHref={playgroundHref}
                onOpen={onOpen}
                onDeploy={onDeploy}
                onDelete={onDelete}
            />
        </span>
    </>
)
