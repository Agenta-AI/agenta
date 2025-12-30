import {useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent} from "react"

import {DownOutlined, MoreOutlined} from "@ant-design/icons"
import {Export, Link, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Popover, Space, Typography} from "antd"
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
    revisionIdParam: string | undefined
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

const dropdownTriggerStyle: CSSProperties = {
    boxSizing: "border-box",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--ant-color-border)",
    borderInlineStartWidth: 0,
    borderStartStartRadius: 0,
    borderEndStartRadius: 0,
    borderStartEndRadius: 6,
    borderEndEndRadius: 6,
    paddingInline: 8,
    paddingBlock: 4,
}

export function TestcaseHeader(props: TestcaseHeaderProps) {
    const {
        testsetName,
        description,
        metadata,
        availableRevisions,
        loadingRevisions,
        isIdCopied,
        isRevisionSlugCopied,
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
        // If revisions haven't been requested yet, show a placeholder to keep dropdown enabled
        if (!revisionsRequested && availableRevisions.length === 0) {
            return [
                {
                    key: "loading-placeholder",
                    label: "Loading revisions...",
                    disabled: true,
                },
            ]
        }

        // If requested but still loading, show loading indicator
        if (loadingRevisions && availableRevisions.length === 0) {
            return [
                {
                    key: "loading",
                    label: "Loading...",
                    disabled: true,
                },
            ]
        }

        // Build menu items from available revisions
        const items = buildRevisionMenuItems(availableRevisions, (revisionId) =>
            router.push(`${projectURL}/testsets/${revisionId}`, undefined, {
                shallow: true,
            }),
        )

        // If requested, loaded, but no revisions found, show empty state
        if (revisionsRequested && !loadingRevisions && (!items || items.length === 0)) {
            return [
                {
                    key: "no-revisions",
                    label: "No revisions found",
                    disabled: true,
                },
            ]
        }

        return items ?? []
    }, [availableRevisions, router, projectURL, revisionsRequested, loadingRevisions])

    // Check if this is the only revision (disable delete if so)
    // v0 is not a valid revision, so we filter it out when counting
    const validRevisions = availableRevisions.filter((r) => r.version > 0)
    // Disable delete if: revisions not loaded yet, still loading, or only one revision
    const isDeleteDisabled =
        !revisionsRequested || loadingRevisions || validRevisions.length <= 1

    // Header actions dropdown menu items
    const headerActionsMenuItems = useMemo(
        () => [
            {
                key: "edit-details",
                label: "Edit name & description",
                icon: <PencilSimple size={16} />,
                onClick: onOpenRenameModal,
            },
            {
                type: "divider" as const,
            },
            {
                key: "export-csv",
                label: "Export as CSV",
                icon: <Export size={16} />,
                onClick: () => onExport("csv"),
            },
            {
                key: "export-json",
                label: "Export as JSON",
                icon: <Export size={16} />,
                onClick: () => onExport("json"),
            },
            {
                type: "divider" as const,
            },
            {
                key: "delete-revision",
                label: loadingRevisions ? "Delete revision..." : "Delete revision",
                icon: <Trash size={16} />,
                danger: true,
                disabled: isDeleteDisabled,
                onClick: onDeleteRevision,
            },
        ],
        [onOpenRenameModal, onDeleteRevision, isDeleteDisabled, onExport, loadingRevisions],
    )

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

    // Copy dropdown menu items
    const copyMenuItems = useMemo(
        () => [
            {
                key: "copy-id",
                label: isIdCopied ? "Copied!" : "Copy ID",
                onClick: handleCopyAction["copy-id"],
            },
            {
                key: "copy-revision-slug",
                label: isRevisionSlugCopied ? "Copied!" : "Copy Revision Slug",
                onClick: handleCopyAction["copy-revision-slug"],
                disabled: !metadata?.revisionSlug,
            },
        ],
        [isIdCopied, isRevisionSlugCopied, handleCopyAction, metadata?.revisionSlug],
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
                <Typography.Title level={3} style={{margin: 0}}>
                    {testsetName || "Testset"}
                </Typography.Title>
                <Dropdown
                    menu={{
                        items: revisionMenuItems,
                        style: {maxHeight: 400, overflowY: "auto"},
                    }}
                    trigger={["click"]}
                    onOpenChange={handleRevisionDropdownOpenChange}
                >
                    <Button size="small" className="flex items-center gap-1">
                        v{metadata?.revisionVersion ?? "#"}
                        <DownOutlined style={{fontSize: 10}} />
                    </Button>
                </Dropdown>
                <Space.Compact size="small">
                    <Button className="flex items-center gap-1" onClick={handleMainButtonClick}>
                        <Link size={14} weight="bold" />
                        <span>{mainButtonLabel}</span>
                    </Button>
                    <Dropdown
                        menu={{items: copyMenuItems}}
                        trigger={["hover"]}
                        popupRender={(menu) => <div>{menu}</div>}
                    >
                        <span
                            role="button"
                            tabIndex={0}
                            aria-haspopup="menu"
                            className="ant-btn ant-btn-default ant-btn-sm ant-space-compact-item flex items-center justify-center !rounded-l-none"
                            style={dropdownTriggerStyle}
                        >
                            <DownOutlined style={{fontSize: 10}} />
                        </span>
                    </Dropdown>
                </Space.Compact>

                <Dropdown
                    menu={{items: headerActionsMenuItems}}
                    trigger={["click"]}
                    onOpenChange={handleActionsDropdownOpenChange}
                >
                    <Button type="text" size="small" icon={<MoreOutlined />} />
                </Dropdown>
            </div>
            <Popover
                trigger="hover"
                placement="bottomLeft"
                content={
                    <div className="flex flex-col gap-2 max-w-xs">
                        {metadata?.testsetSlug && (
                            <div>
                                <Typography.Text type="secondary" className="block">
                                    Testset Slug
                                </Typography.Text>
                                <Typography.Text>{metadata.testsetSlug}</Typography.Text>
                            </div>
                        )}
                        {metadata?.revisionSlug && (
                            <div>
                                <Typography.Text type="secondary" className="block">
                                    Revision Slug
                                </Typography.Text>
                                <Typography.Text>{metadata.revisionSlug}</Typography.Text>
                            </div>
                        )}
                        {metadata?.commitMessage && (
                            <div>
                                <Typography.Text type="secondary" className="block">
                                    Commit Message
                                </Typography.Text>
                                <Typography.Text>{metadata.commitMessage}</Typography.Text>
                            </div>
                        )}
                        {metadata?.author && (
                            <div>
                                <Typography.Text type="secondary" className="block">
                                    Author
                                </Typography.Text>
                                <UserReference userId={metadata.author} />
                            </div>
                        )}
                        {metadata?.createdAt && (
                            <div>
                                <Typography.Text type="secondary" className="block">
                                    Created
                                </Typography.Text>
                                <Typography.Text>
                                    {new Date(metadata.createdAt).toLocaleString()}
                                </Typography.Text>
                            </div>
                        )}
                        {metadata?.updatedAt && (
                            <div>
                                <Typography.Text type="secondary" className="block">
                                    Updated
                                </Typography.Text>
                                <Typography.Text>
                                    {new Date(metadata.updatedAt).toLocaleString()}
                                </Typography.Text>
                            </div>
                        )}
                    </div>
                }
            >
                <span className="cursor-help">
                    <TableDescription>
                        {description ||
                            "Specify column names similar to the Input parameters. A column with 'correct_answer' name will be treated as a ground truth column."}
                    </TableDescription>
                </span>
            </Popover>
        </div>
    )
}
