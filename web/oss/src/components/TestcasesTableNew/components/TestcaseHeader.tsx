import {useEffect, useMemo, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {
    CaretDown,
    DotsThreeVertical,
    Export,
    Link,
    PencilSimple,
    Trash,
} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {TableDescription} from "@/oss/components/InfiniteVirtualTable"
import {UserReference} from "@/oss/components/References/UserReference"
import type {ExportFileType} from "@/oss/services/testsets/api"
import {enableRevisionsListQueryAtom} from "@/oss/state/entities/testset"

import type {RevisionListItem, TestsetMetadata} from "../hooks/types"

import {buildRevisionMenuItems} from "./RevisionMenuItems"

/**
 * Props for TestcaseHeader component
 */
export interface TestcaseHeaderProps {
    testsetName: string
    description: string
    metadata: TestsetMetadata | null
    availableRevisions: RevisionListItem[]
    loadingRevisions: boolean
    isIdCopied: boolean
    isRevisionSlugCopied: boolean
    canExportData: boolean
    revisionIdParam: string | undefined
    /** Whether this is a new testset (not yet saved) - disables server-dependent features */
    isNewTestset?: boolean
    /** Whether an export is currently in progress */
    isExporting?: boolean
    onCopyId: () => void
    onCopyRevisionSlug: () => void
    onOpenRenameModal: () => void
    onDeleteRevision: () => void
    onExport: (fileType: ExportFileType) => void
    projectURL: string
}

/**
 * TestcaseHeader - Header section for testcases table
 *
 * Displays:
 * - Testset title with revision selector dropdown
 * - ID copy button
 * - Actions menu (edit name, delete revision)
 * - Description with metadata popover
 *
 * @component
 */
type CopyAction = "copy-id" | "copy-revision-slug"

const COPY_ACTION_STORAGE_KEY = "testcase-header-last-copy-action"

export function TestcaseHeader(props: TestcaseHeaderProps) {
    const {
        testsetName,
        description,
        metadata,
        availableRevisions,
        loadingRevisions,
        isIdCopied,
        isRevisionSlugCopied,
        canExportData,
        isNewTestset = false,
        isExporting = false,
        onCopyId,
        onCopyRevisionSlug,
        onOpenRenameModal,
        onDeleteRevision,
        onExport,
        projectURL,
    } = props

    const router = useRouter()
    const enableRevisionsListQuery = useSetAtom(enableRevisionsListQueryAtom)

    // Remember last selected copy action
    const [lastCopyAction, setLastCopyAction] = useState<CopyAction>("copy-id")

    // Track whether revisions have been requested (to distinguish "not loaded" from "loaded but empty")
    const [revisionsRequested, setRevisionsRequested] = useState(false)
    const [metadataOpen, setMetadataOpen] = useState(false)

    // Enable revisions list query when dropdown is opened
    const handleRevisionDropdownOpenChange = (open: boolean) => {
        if (open && metadata?.testsetId && !revisionsRequested) {
            enableRevisionsListQuery(metadata.testsetId)
            setRevisionsRequested(true)
        }
    }

    // Enable revisions list query when actions dropdown is opened (needed for delete/redirect)
    const handleActionsDropdownOpenChange = (open: boolean) => {
        if (open && metadata?.testsetId && !revisionsRequested) {
            enableRevisionsListQuery(metadata.testsetId)
            setRevisionsRequested(true)
        }
    }

    // Load last copy action from localStorage
    useEffect(() => {
        const saved = localStorage.getItem(COPY_ACTION_STORAGE_KEY) as CopyAction | null
        if (saved === "copy-id" || saved === "copy-revision-slug") {
            setLastCopyAction(saved)
        }
    }, [])

    // Revision dropdown menu items
    const revisionMenuItems = useMemo(() => {
        if (!revisionsRequested && availableRevisions.length === 0) {
            return [
                <DropdownMenuItem key="loading-placeholder" disabled>
                    Loading revisions...
                </DropdownMenuItem>,
            ]
        }

        if (loadingRevisions && availableRevisions.length === 0) {
            return [
                <DropdownMenuItem key="loading" disabled>
                    Loading...
                </DropdownMenuItem>,
            ]
        }

        const items = buildRevisionMenuItems(availableRevisions, (revisionId) =>
            router.push(`${projectURL}/testsets/${revisionId}`, undefined, {
                shallow: true,
            }),
        )

        if (revisionsRequested && !loadingRevisions && (!items || items.length === 0)) {
            return [
                <DropdownMenuItem key="no-revisions" disabled>
                    No revisions found
                </DropdownMenuItem>,
            ]
        }

        return items ?? []
    }, [availableRevisions, router, projectURL, revisionsRequested, loadingRevisions])

    const validRevisions = availableRevisions.filter((r) => r.version > 0)
    const isDeleteDisabled = !revisionsRequested || loadingRevisions || validRevisions.length <= 1

    // Handler to execute copy action and remember it
    const handleCopyAction = useMemo(
        () => ({
            "copy-id": () => {
                onCopyId()
                setLastCopyAction("copy-id")
                localStorage.setItem(COPY_ACTION_STORAGE_KEY, "copy-id")
            },
            "copy-revision-slug": () => {
                onCopyRevisionSlug()
                setLastCopyAction("copy-revision-slug")
                localStorage.setItem(COPY_ACTION_STORAGE_KEY, "copy-revision-slug")
            },
        }),
        [onCopyId, onCopyRevisionSlug],
    )

    // Main button click executes last selected action
    const handleMainButtonClick = () => {
        // If last action was revision slug but it's not available, default to copy ID
        if (lastCopyAction === "copy-revision-slug" && !metadata?.revisionSlug) {
            handleCopyAction["copy-id"]()
        } else {
            handleCopyAction[lastCopyAction]()
        }
    }

    // Get label for main button based on last action
    const mainButtonLabel = useMemo(() => {
        // If last action was revision slug but it's not available, show ID
        if (lastCopyAction === "copy-revision-slug" && metadata?.revisionSlug) {
            return isRevisionSlugCopied ? "Copied!" : "Slug"
        }
        return isIdCopied ? "Copied!" : "ID"
    }, [lastCopyAction, isIdCopied, isRevisionSlugCopied, metadata?.revisionSlug])

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <h3 style={{margin: 0}} className="text-lg font-semibold leading-snug">
                    {testsetName || "Test set"}
                </h3>
                <DropdownMenu
                    onOpenChange={(open) => {
                        handleRevisionDropdownOpenChange(open)
                    }}
                >
                    <DropdownMenuTrigger
                        className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-primary text-primary-foreground hover:bg-primary/80 text-sm font-medium transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        v{metadata?.revisionVersion ?? "#"}
                        <CaretDown size={10} weight="bold" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent style={{maxHeight: 400, overflowY: "auto"}}>
                        {revisionMenuItems}
                    </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex items-center">
                    <Button className="rounded-r-none border-r-0" onClick={handleMainButtonClick}>
                        <Link size={14} weight="bold" />
                        <span>{mainButtonLabel}</span>
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            openOnHover
                            className="inline-flex shrink-0 items-center justify-center rounded-lg border bg-background text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 h-7 gap-1 px-2.5 rounded-l-none border-l-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <CaretDown size={10} weight="bold" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem onClick={handleCopyAction["copy-id"]}>
                                {isIdCopied ? "Copied!" : "Copy ID"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={handleCopyAction["copy-revision-slug"]}
                                disabled={!metadata?.revisionSlug}
                            >
                                {isRevisionSlugCopied ? "Copied!" : "Copy Revision Slug"}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <DropdownMenu
                    onOpenChange={(open) => {
                        if (open) handleActionsDropdownOpenChange(open)
                    }}
                >
                    <DropdownMenuTrigger
                        className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent size-7 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <DotsThreeVertical size={16} weight="bold" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onClick={onOpenRenameModal}>
                            <PencilSimple size={16} />
                            Edit name & description
                        </DropdownMenuItem>
                        {canExportData && (
                            <>
                                <DropdownMenuItem
                                    disabled={isExporting}
                                    onClick={() => onExport("csv")}
                                >
                                    <Export size={16} />
                                    {isExporting ? "Exporting..." : "Export as CSV"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={isExporting}
                                    onClick={() => onExport("json")}
                                >
                                    <Export size={16} />
                                    {isExporting ? "Exporting..." : "Export as JSON"}
                                </DropdownMenuItem>
                            </>
                        )}
                        <DropdownMenuItem
                            variant="destructive"
                            disabled={isDeleteDisabled}
                            onClick={onDeleteRevision}
                        >
                            <Trash size={16} />
                            {loadingRevisions ? "Delete revision..." : "Delete revision"}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {/* Metadata popover - disabled for new testsets since server data doesn't exist yet */}
            {isNewTestset ? (
                <TableDescription>
                    {description ||
                        "Specify column names similar to the Input parameters. A column with 'correct_answer' name will be treated as a ground truth column."}
                </TableDescription>
            ) : (
                <Popover
                    open={metadataOpen}
                    onOpenChange={(open, eventDetails) => {
                        if (eventDetails.reason === "trigger-press") return
                        setMetadataOpen(open)
                    }}
                >
                    <PopoverTrigger
                        nativeButton={false}
                        openOnHover
                        render={<span className="cursor-help" />}
                    >
                        <TableDescription>
                            {description ||
                                "Specify column names similar to the Input parameters. A column with 'correct_answer' name will be treated as a ground truth column."}
                        </TableDescription>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="start" className="w-auto max-w-xs">
                        <div className="flex flex-col gap-2 max-w-xs">
                            {metadata?.testsetSlug && (
                                <div>
                                    <span className="block text-muted-foreground">
                                        Testset Slug
                                    </span>
                                    <span>{metadata.testsetSlug}</span>
                                </div>
                            )}
                            {metadata?.revisionSlug && (
                                <div>
                                    <span className="block text-muted-foreground">
                                        Revision Slug
                                    </span>
                                    <span>{metadata.revisionSlug}</span>
                                </div>
                            )}
                            {metadata?.commitMessage && (
                                <div>
                                    <span className="block text-muted-foreground">
                                        Commit Message
                                    </span>
                                    <span>{metadata.commitMessage}</span>
                                </div>
                            )}
                            {metadata?.author && (
                                <div>
                                    <span className="block text-muted-foreground">Author</span>
                                    <UserReference userId={metadata.author} />
                                </div>
                            )}
                            {metadata?.createdAt && (
                                <div>
                                    <span className="block text-muted-foreground">Created</span>
                                    <span>{new Date(metadata.createdAt).toLocaleString()}</span>
                                </div>
                            )}
                            {metadata?.updatedAt && (
                                <div>
                                    <span className="block text-muted-foreground">Updated</span>
                                    <span>{new Date(metadata.updatedAt).toLocaleString()}</span>
                                </div>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    )
}
