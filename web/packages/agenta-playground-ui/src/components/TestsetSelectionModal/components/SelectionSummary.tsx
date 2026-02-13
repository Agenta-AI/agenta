/**
 * SelectionSummary Component
 *
 * Footer component for TestsetSelectionModal showing selection count,
 * import mode selector (when applicable), and action buttons.
 */

import {bgColors, borderColors, cn, statusColors, textSizes} from "@agenta/ui/styles"
import {Button, Radio, Space, Typography} from "antd"

import type {SelectionSummaryProps, TestsetImportMode} from "../types"

const {Text} = Typography

export function SelectionSummary({
    selectedCount,
    totalCount,
    onConfirm,
    onCancel,
    confirmDisabled = false,
    confirmText = "Load Selected",
    importMode = "replace",
    onImportModeChange,
    showImportModeSelector = false,
    disabled = false,
    disabledMessage = "This revision is already connected. Select a different revision to load.",
}: SelectionSummaryProps) {
    // When disabled, show a message instead of the normal UI
    if (disabled) {
        return (
            <div className="flex flex-col gap-3">
                {/* Disabled message */}
                <div
                    className={`border ${borderColors.default} rounded-md p-3 ${statusColors.warningBg}`}
                >
                    <Text type="warning">{disabledMessage}</Text>
                </div>

                {/* Footer row with just cancel button */}
                <div className="flex items-center justify-end">
                    <Button onClick={onCancel}>Cancel</Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Import Mode Selector - only shown when there's existing data */}
            {showImportModeSelector && onImportModeChange && (
                <div
                    className={`border ${borderColors.secondary} rounded-md p-3 ${bgColors.subtle}`}
                >
                    <Text
                        type="secondary"
                        className={cn(textSizes.xs, "uppercase tracking-wide block mb-2")}
                    >
                        What would you like to do?
                    </Text>
                    <Radio.Group
                        value={importMode}
                        onChange={(e) => onImportModeChange(e.target.value as TestsetImportMode)}
                        className="flex flex-col gap-2"
                    >
                        <Radio value="replace">
                            <div>
                                <Text strong>Replace and connect</Text>
                                <Text type="secondary" className={cn("block", textSizes.xs)}>
                                    Discard current data, sync with selected testcases
                                </Text>
                            </div>
                        </Radio>
                        <Radio value="import">
                            <div>
                                <Text strong>Import as new rows</Text>
                                <Text type="secondary" className={cn("block", textSizes.xs)}>
                                    Keep current data, add selected as new local rows
                                </Text>
                            </div>
                        </Radio>
                    </Radio.Group>
                </div>
            )}

            {/* Footer row with count and buttons */}
            <div className="flex items-center justify-between">
                {/* Selection Count */}
                <div>
                    <Text type="secondary">
                        <Text strong>{selectedCount}</Text> of <Text strong>{totalCount}</Text>{" "}
                        testcases selected
                    </Text>
                </div>

                {/* Action Buttons */}
                <Space>
                    <Button onClick={onCancel}>Cancel</Button>
                    <Button type="primary" onClick={onConfirm} disabled={confirmDisabled}>
                        {confirmText}
                    </Button>
                </Space>
            </div>
        </div>
    )
}
