import {useMemo} from "react"

import {DownOutlined, MoreOutlined} from "@ant-design/icons"
import {Link, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Popover, Tag, Tooltip, Typography} from "antd"
import {useRouter} from "next/router"

import {TableDescription} from "@/oss/components/InfiniteVirtualTable"
import {UserReference} from "@/oss/components/References/UserReference"

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
    revisionIdParam: string | undefined
    onCopyId: () => void
    onOpenRenameModal: () => void
    onDeleteRevision: () => void
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
export function TestcaseHeader(props: TestcaseHeaderProps) {
    const {
        testsetName,
        description,
        metadata,
        availableRevisions,
        loadingRevisions,
        isIdCopied,
        onCopyId,
        onOpenRenameModal,
        onDeleteRevision,
        projectURL,
    } = props

    const router = useRouter()

    // Revision dropdown menu items
    const revisionMenuItems = useMemo(
        () =>
            buildRevisionMenuItems(availableRevisions, (revisionId) =>
                router.push(`${projectURL}/testsets/${revisionId}`, undefined, {
                    shallow: true,
                }),
            ) ?? [],
        [availableRevisions, router, projectURL],
    )

    // Check if this is the only revision (disable delete if so)
    // v0 is not a valid revision, so we filter it out when counting
    const validRevisions = availableRevisions.filter((r) => r.version > 0)
    const isOnlyRevision = validRevisions.length <= 1

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
                key: "delete-revision",
                label: "Delete revision",
                icon: <Trash size={16} />,
                danger: true,
                disabled: isOnlyRevision,
                onClick: onDeleteRevision,
            },
        ],
        [onOpenRenameModal, onDeleteRevision, isOnlyRevision],
    )

    // Tooltip for ID copy
    const tooltipTitle = isIdCopied ? "Copied!" : "Click to copy ID"

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
                    disabled={loadingRevisions || revisionMenuItems.length === 0}
                >
                    <Button size="small" className="flex items-center gap-1">
                        v{metadata?.revisionVersion ?? "#"}
                        <DownOutlined style={{fontSize: 10}} />
                    </Button>
                </Dropdown>
                <Tooltip title={tooltipTitle}>
                    <Tag className="cursor-pointer flex items-center gap-1" onClick={onCopyId}>
                        <Link size={14} weight="bold" />
                        <span>ID</span>
                    </Tag>
                </Tooltip>
                <Dropdown menu={{items: headerActionsMenuItems}} trigger={["click"]}>
                    <Button type="text" size="small" icon={<MoreOutlined />} />
                </Dropdown>
            </div>
            <Popover
                trigger="hover"
                placement="bottomLeft"
                content={
                    <div className="flex flex-col gap-2 max-w-xs">
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
