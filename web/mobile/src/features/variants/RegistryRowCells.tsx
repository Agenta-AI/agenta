import {UserAuthorLabel} from "@agenta/entities/shared"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {FormattedDate} from "@agenta/ui/components/presentational"
import {MinusCircle, PlusCircle} from "@phosphor-icons/react"

import type {RegistryRow} from "./registryRows"
import type {AppRevisionRow} from "./useAppRevisions"
import {VariantRowMenu} from "./VariantRowMenu"

const stop = {
    onClick: (event: {stopPropagation: () => void}) => event.stopPropagation(),
    onKeyDown: (event: {stopPropagation: () => void}) => event.stopPropagation(),
}

/** One Registry row's cells, in column order, with the old app's columns. */
export const RegistryRowCells = ({
    row,
    narrow,
    isLatest,
    expanded,
    onToggle,
    canDeploy,
    canDelete,
    playgroundHref,
    onOpen,
    onDeploy,
    onDelete,
}: {
    row: RegistryRow
    narrow: boolean
    isLatest: boolean
    expanded: boolean
    onToggle: () => void
    canDeploy: boolean
    canDelete: boolean
    playgroundHref: ((row: AppRevisionRow) => string) | null
    onOpen: (row: AppRevisionRow) => void
    onDeploy: (row: AppRevisionRow) => void
    onDelete: (row: RegistryRow) => void
}) => {
    const {revision} = row
    const Toggle = expanded ? MinusCircle : PlusCircle
    return (
        <>
            <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium text-foreground">
                {row.kind === "variant" ? (
                    row.olderCount > 0 ? (
                        <button
                            type="button"
                            onKeyDown={stop.onKeyDown}
                            onClick={(event) => {
                                event.stopPropagation()
                                onToggle()
                            }}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Hide" : "Show"} older revisions of ${revision.variantName}`}
                            className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                        >
                            <Toggle aria-hidden size={14} />
                        </button>
                    ) : (
                        <span aria-hidden className="w-3.5 shrink-0" />
                    )
                ) : row.nested ? (
                    <span aria-hidden className="w-7 shrink-0" />
                ) : null}
                <span className="min-w-0 truncate">
                    <VariantDetailsWithStatus
                        variant={{id: revision.revisionId}}
                        variantName={revision.variantName}
                        revision={revision.version}
                        isLatest={isLatest && !narrow}
                        showBadges
                        showRevisionAsTag
                        hideDiscard
                        showStable
                    />
                </span>
            </span>
            {narrow ? null : (
                <span className="block break-all text-[13px] text-foreground">
                    {revision.model || "—"}
                </span>
            )}
            <span className="block truncate text-[13px] text-foreground">
                <FormattedDate
                    date={revision.createdAt}
                    format={narrow ? "MMM D, YYYY" : "MMM D, YYYY, h:mm A"}
                    fallback="—"
                />
            </span>
            {narrow ? null : (
                <span className="block truncate text-[13px] text-muted-foreground">
                    <UserAuthorLabel
                        userId={revision.createdById}
                        showYouLabel
                        showAvatar
                        fallback="—"
                    />
                </span>
            )}
            {narrow ? null : (
                <span
                    className="block truncate text-[13px] text-muted-foreground"
                    title={revision.message ?? undefined}
                >
                    {revision.message || ""}
                </span>
            )}
            <span className="flex justify-end" {...stop}>
                <VariantRowMenu
                    row={revision}
                    canDeploy={canDeploy}
                    canDelete={canDelete}
                    deleteLabel={row.kind === "variant" ? "Delete variant" : "Delete"}
                    playgroundHref={playgroundHref}
                    onOpen={onOpen}
                    onDeploy={onDeploy}
                    onDelete={() => onDelete(row)}
                />
            </span>
        </>
    )
}
