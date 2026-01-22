/**
 * DataSourceSection Component
 *
 * Displays the "Data Source" section for primary nodes showing:
 * - Remote testset connection (with commit/discard/disconnect buttons)
 * - Local testset mode (with save/change buttons)
 *
 * UI Design:
 * - Primary action (Save/Commit) shown as button when there are changes
 * - Secondary actions in dropdown menu (Edit selection, Change, Discard)
 * - Visual indicator (dot) on dropdown when there are changes
 */

import {cn, statusColors, textColors, entityIconColors} from "@agenta/ui"
import {
    ArrowCounterClockwise,
    DotsThreeVertical,
    FloppyDisk,
    Link,
    PencilSimple,
    Table,
} from "@phosphor-icons/react"
import {Button, Dropdown, Tag, Tooltip, Typography} from "antd"
import type {MenuProps} from "antd"

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
    /** Callback to edit testcase selection (modify which testcases are included) */
    onEditSelection?: () => void
}

export function DataSourceSection({
    connectedTestsetName,
    connectedTestsetId,
    onConnectTestset,
    onNavigateToTestset,
    localTestcaseCount = 0,
    onSaveAsTestset,
    hasLocalChanges = false,
    onCommitChanges,
    isCommitting = false,
    onDiscardChanges,
    onEditSelection,
}: DataSourceSectionProps) {
    // Remote testset = has name AND id (connected to a saved testset)
    const isRemoteTestset = !!connectedTestsetName && !!connectedTestsetId

    // Build dropdown menu items
    const menuItems: MenuProps["items"] = []

    if (isRemoteTestset) {
        // Connected testset actions
        if (onEditSelection) {
            menuItems.push({
                key: "edit",
                label: "Edit selection",
                icon: <PencilSimple size={14} />,
                onClick: onEditSelection,
                disabled: isCommitting,
            })
        }
        if (onConnectTestset) {
            menuItems.push({
                key: "change",
                label: "Load different testset",
                icon: <Link size={14} />,
                onClick: onConnectTestset,
                disabled: isCommitting,
            })
        }
        if (hasLocalChanges && onDiscardChanges) {
            menuItems.push({type: "divider"})
            menuItems.push({
                key: "discard",
                label: "Discard changes",
                icon: <ArrowCounterClockwise size={14} />,
                onClick: onDiscardChanges,
                disabled: isCommitting,
                danger: true,
            })
        }
    } else {
        // Local testset actions
        if (onEditSelection) {
            menuItems.push({
                key: "edit",
                label: "Edit selection",
                icon: <PencilSimple size={14} />,
                onClick: onEditSelection,
            })
        }
        if (onConnectTestset) {
            menuItems.push({
                key: "load",
                label: "Load from testset",
                icon: <Link size={14} />,
                onClick: onConnectTestset,
            })
        }
    }

    return (
        <div className="px-3 py-2">
            <Text type="secondary" className="text-xs uppercase tracking-wide">
                Data Source
            </Text>

            {/* Unified layout for both local and connected testsets */}
            <div className="mt-2 flex items-center justify-between gap-2">
                {/* Left side: Icon + Name + Row count */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isRemoteTestset ? (
                        <Link size={14} className={cn(statusColors.successIcon, "flex-shrink-0")} />
                    ) : (
                        <Table
                            size={14}
                            className={cn(entityIconColors.primary, "flex-shrink-0")}
                        />
                    )}
                    <Tag
                        color={isRemoteTestset ? (hasLocalChanges ? "orange" : "green") : "blue"}
                        className={`m-0 max-w-[180px] truncate ${isRemoteTestset ? "cursor-pointer" : ""}`}
                        onClick={isRemoteTestset ? onNavigateToTestset : undefined}
                    >
                        {connectedTestsetName || "Local"}
                    </Tag>
                    <span
                        className={cn(
                            "text-xs flex-shrink-0 whitespace-nowrap",
                            textColors.secondary,
                        )}
                    >
                        {localTestcaseCount} row{localTestcaseCount !== 1 ? "s" : ""}
                    </span>
                </div>

                {/* Right side: Primary action + Dropdown menu */}
                <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Primary action: Save/Commit button - always visible when applicable */}
                    {isRemoteTestset
                        ? // Connected: Show commit button when there are changes
                          hasLocalChanges &&
                          onCommitChanges && (
                              <Tooltip title="Commit changes as new revision">
                                  <Button
                                      type="primary"
                                      size="small"
                                      icon={<FloppyDisk size={12} />}
                                      onClick={onCommitChanges}
                                      loading={isCommitting}
                                  >
                                      Save
                                  </Button>
                              </Tooltip>
                          )
                        : // Local: Show save button when there's data
                          onSaveAsTestset &&
                          localTestcaseCount > 0 && (
                              <Tooltip title="Save as new testset">
                                  <Button
                                      type="primary"
                                      size="small"
                                      icon={<FloppyDisk size={12} />}
                                      onClick={onSaveAsTestset}
                                  >
                                      Save
                                  </Button>
                              </Tooltip>
                          )}

                    {/* Dropdown menu for secondary actions */}
                    {menuItems.length > 0 && (
                        <Dropdown
                            menu={{items: menuItems}}
                            trigger={["click"]}
                            placement="bottomRight"
                        >
                            <Button
                                type="text"
                                size="small"
                                icon={<DotsThreeVertical size={16} weight="bold" />}
                                className={cn(textColors.secondary, textColors.iconHover)}
                            />
                        </Dropdown>
                    )}
                </div>
            </div>
        </div>
    )
}
