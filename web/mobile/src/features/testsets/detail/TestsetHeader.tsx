import {useState, type ReactNode} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import type {TestsetRevisionHeader} from "@agenta/entities/testset"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@agenta/ui/ui"
import {
    Archive,
    DotsThreeVertical,
    FileCsv,
    FileJs,
    Info,
    PencilSimple,
} from "@phosphor-icons/react"

import {EditTestsetDetailsDialog} from "./EditTestsetDetailsDialog"
import {TestsetCopyControl} from "./TestsetCopyControl"
import {TestsetVersionMenu} from "./TestsetVersionMenu"
import type {RevisionsList} from "./useRevisionsList"

/** Shown when a test set has no description. It tells a new reader what the columns are for. */
export const DEFAULT_DESCRIPTION =
    "Specify column names similar to the Input parameters. A column with 'correct_answer' name will be treated as a ground truth column."

export interface TestsetHeaderProps {
    header: TestsetRevisionHeader | null
    revisionId: string | null
    isNew: boolean
    canEdit: boolean
    canExport: boolean
    revisions: Pick<RevisionsList, "revisions" | "status" | "load">
    onPickRevision: (revisionId: string) => void
    /** Saves the name and description; answers whether it saved. */
    onSaveDetails: (name: string, description: string) => Promise<boolean>
    savingDetails: boolean
    /** The format an export is running in, or null. */
    exporting: "csv" | "json" | null
    onExport: (format: "csv" | "json") => void
    /** Why "Archive revision" is off, or null when it is on. */
    archiveDisabledReason: string | null
    onArchive: () => void
}

const formatDateTime = (value: string | undefined) => {
    if (!value) return null
    const time = Date.parse(value)
    return Number.isNaN(time) ? null : new Date(time).toLocaleString()
}

/**
 * The top of a test set page: name, version, copy, the actions menu and the description.
 * Every verb a reader may not use is left out, not disabled.
 */
export const TestsetHeader = ({
    header,
    revisionId,
    isNew,
    canEdit,
    canExport,
    revisions,
    onPickRevision,
    onSaveDetails,
    savingDetails,
    exporting,
    onExport,
    archiveDisabledReason,
    onArchive,
}: TestsetHeaderProps) => {
    const [editing, setEditing] = useState(false)
    const name = header?.testsetName ?? ""
    const showActions = !isNew && (canEdit || canExport)

    return (
        <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                    {name || "Test set"}
                </h1>
                {isNew ? null : (
                    <TestsetVersionMenu
                        version={header?.revisionVersion}
                        currentRevisionId={revisionId}
                        list={revisions}
                        onPick={onPickRevision}
                    />
                )}
                {isNew ? null : (
                    <TestsetCopyControl
                        revisionId={revisionId}
                        revisionSlug={header?.revisionSlug}
                    />
                )}
                {showActions ? (
                    <DropdownMenu onOpenChange={(open) => (open ? revisions.load() : undefined)}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Test set actions"
                            >
                                <DotsThreeVertical aria-hidden size={16} weight="bold" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-[220px]">
                            {canEdit ? (
                                <DropdownMenuItem onSelect={() => setEditing(true)}>
                                    <PencilSimple aria-hidden size={14} />
                                    Edit name & description
                                </DropdownMenuItem>
                            ) : null}
                            {canExport ? (
                                <>
                                    <DropdownMenuItem
                                        disabled={exporting !== null}
                                        onSelect={() => onExport("csv")}
                                    >
                                        <FileCsv aria-hidden size={14} />
                                        {exporting === "csv" ? "Exporting..." : "Export as CSV"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={exporting !== null}
                                        onSelect={() => onExport("json")}
                                    >
                                        <FileJs aria-hidden size={14} />
                                        {exporting === "json" ? "Exporting..." : "Export as JSON"}
                                    </DropdownMenuItem>
                                </>
                            ) : null}
                            {canEdit ? (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        variant="destructive"
                                        disabled={archiveDisabledReason !== null}
                                        onSelect={onArchive}
                                    >
                                        <Archive aria-hidden size={14} />
                                        Archive revision
                                    </DropdownMenuItem>
                                    {archiveDisabledReason ? (
                                        <p className="m-0 px-2 pb-1.5 text-xs text-muted-foreground">
                                            {archiveDisabledReason}
                                        </p>
                                    ) : null}
                                </>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>
            <div className="flex min-w-0 items-start gap-1.5">
                <p className="m-0 min-w-0 text-[13px] leading-5 text-muted-foreground">
                    {header?.description || DEFAULT_DESCRIPTION}
                </p>
                {isNew || !header ? null : <TestsetDetailsPopover header={header} />}
            </div>
            <EditTestsetDetailsDialog
                open={editing}
                name={name}
                description={header?.description ?? ""}
                pending={savingDetails}
                onClose={() => setEditing(false)}
                onSave={(nextName, nextDescription) => {
                    void onSaveDetails(nextName, nextDescription).then((saved) => {
                        if (saved) setEditing(false)
                    })
                }}
            />
        </div>
    )
}

/**
 * The slugs, commit message, author and dates. A popover opens on a press, because a phone has
 * no hover. A line shows only when the value is set.
 */
const TestsetDetailsPopover = ({header}: {header: TestsetRevisionHeader}) => {
    const rows: {label: string; value: ReactNode}[] = [
        {label: "Test set slug", value: header.testsetSlug},
        {label: "Revision slug", value: header.revisionSlug},
        {label: "Commit message", value: header.commitMessage},
        {
            label: "Author",
            value: header.author ? <UserAuthorLabel userId={header.author} fallback="" /> : null,
        },
        {label: "Created", value: formatDateTime(header.createdAt)},
        {label: "Updated", value: formatDateTime(header.updatedAt)},
    ].filter((row) => Boolean(row.value))

    if (rows.length === 0) return null
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Test set details"
                    className="shrink-0"
                >
                    <Info aria-hidden size={14} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(340px,90vw)]">
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                    {rows.map((row) => (
                        <div key={row.label} className="contents">
                            <dt className="text-muted-foreground">{row.label}</dt>
                            <dd className="m-0 min-w-0 break-words text-foreground">{row.value}</dd>
                        </div>
                    ))}
                </dl>
            </PopoverContent>
        </Popover>
    )
}
