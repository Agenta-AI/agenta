/**
 * SelectionSummary Component
 *
 * Footer component for TestsetSelectionModal showing selection count,
 * import mode selector (when applicable), and action buttons.
 */

import {borderColors, statusColors} from "@agenta/ui/styles"
import {Button, Space, Typography} from "antd"

import type {SelectionSummaryProps} from "../types"

const {Text} = Typography

export function SelectionSummary({
    selectedCount,
    totalCount,
    onConfirm,
    onCancel,
    confirmDisabled = false,
    confirmText = "Confirm Selection",
    disabled = false,
    disabledMessage = "Cannot select items from this testset",
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
