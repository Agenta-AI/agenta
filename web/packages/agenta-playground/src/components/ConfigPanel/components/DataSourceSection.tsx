/**
 * DataSourceSection Component
 *
 * Displays the "Data Source" section for primary nodes showing:
 * - Remote testset connection (with commit/discard/disconnect buttons)
 * - Local testset mode (with save/change buttons)
 */

import {
    ArrowCounterClockwise,
    FloppyDisk,
    GitCommit,
    Link,
    LinkBreak,
    Table,
} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"

const {Text} = Typography

export interface DataSourceSectionProps {
    /** Connected testset name (for display) */
    connectedTestsetName?: string
    /** Connected testset ID - if set, it's a remote testset; if null/undefined with name, it's local */
    connectedTestsetId?: string | null
    /** Callback to open testset connection modal */
    onConnectTestset?: () => void
    /** Navigate to connected testset */
    onNavigateToTestset?: () => void
    /** Disconnect from testset */
    onDisconnectTestset?: () => void
    /** Number of testcases (local or loaded) */
    localTestcaseCount?: number
    /** Callback to save local testcases as a new testset */
    onSaveAsTestset?: () => void
    /** Whether there are uncommitted local changes to the connected testset */
    hasLocalChanges?: boolean
    /** Callback to commit local changes to connected testset as new revision */
    onCommitChanges?: () => void | Promise<void>
    /** Whether commit is in progress */
    isCommitting?: boolean
    /** Callback to discard local changes */
    onDiscardChanges?: () => void
}

export function DataSourceSection({
    connectedTestsetName,
    connectedTestsetId,
    onConnectTestset,
    onNavigateToTestset,
    onDisconnectTestset,
    localTestcaseCount = 0,
    onSaveAsTestset,
    hasLocalChanges = false,
    onCommitChanges,
    isCommitting = false,
    onDiscardChanges,
}: DataSourceSectionProps) {
    // Remote testset = has name AND id (connected to a saved testset)
    const isRemoteTestset = !!connectedTestsetName && !!connectedTestsetId

    return (
        <div className="px-3 py-2">
            <Text type="secondary" className="text-xs uppercase tracking-wide">
                Data Source
            </Text>

            {isRemoteTestset ? (
                /* Connected to Remote Testset */
                <div className="mt-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Link size={14} className="text-green-600" />
                            <Tag
                                color={hasLocalChanges ? "orange" : "green"}
                                className="cursor-pointer m-0"
                                onClick={onNavigateToTestset}
                            >
                                {connectedTestsetName}
                                {hasLocalChanges && " (modified)"}
                            </Tag>
                        </div>
                        <div className="flex items-center gap-1">
                            {/* Commit button - only when there are local changes */}
                            {hasLocalChanges && onCommitChanges && (
                                <Tooltip title="Commit changes as new revision">
                                    <Button
                                        type="primary"
                                        size="small"
                                        icon={<GitCommit size={14} />}
                                        onClick={onCommitChanges}
                                        loading={isCommitting}
                                    >
                                        Commit
                                    </Button>
                                </Tooltip>
                            )}
                            {/* Discard button - only when there are local changes */}
                            {hasLocalChanges && onDiscardChanges && (
                                <Tooltip title="Discard local changes">
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<ArrowCounterClockwise size={14} />}
                                        onClick={onDiscardChanges}
                                        disabled={isCommitting}
                                        className="text-gray-400 hover:text-gray-600"
                                    />
                                </Tooltip>
                            )}
                            <Tooltip title="Disconnect and use local testset">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<LinkBreak size={14} />}
                                    onClick={onDisconnectTestset}
                                    disabled={isCommitting}
                                    className="text-gray-400 hover:text-gray-600"
                                />
                            </Tooltip>
                        </div>
                    </div>
                </div>
            ) : (
                /* Local Testset Mode - Single row layout */
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Table size={14} className="text-blue-500 flex-shrink-0" />
                        <Tag color="blue" className="m-0 max-w-[180px] truncate">
                            {connectedTestsetName || "Local"}
                        </Tag>
                        <span className="text-xs text-gray-500 flex-shrink-0 whitespace-nowrap">
                            {localTestcaseCount} row
                            {localTestcaseCount !== 1 ? "s" : ""}
                        </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {onSaveAsTestset && (
                            <Tooltip title="Save local testset to project">
                                <Button
                                    type="default"
                                    size="small"
                                    icon={<FloppyDisk size={12} />}
                                    onClick={onSaveAsTestset}
                                    disabled={localTestcaseCount === 0}
                                >
                                    Save
                                </Button>
                            </Tooltip>
                        )}
                        <Tooltip title="Replace with existing testset">
                            <Button
                                type="default"
                                size="small"
                                icon={<Link size={12} />}
                                onClick={onConnectTestset}
                            >
                                Change
                            </Button>
                        </Tooltip>
                    </div>
                </div>
            )}
        </div>
    )
}
