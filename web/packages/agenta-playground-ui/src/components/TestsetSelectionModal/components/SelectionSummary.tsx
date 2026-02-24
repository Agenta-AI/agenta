/**
 * SelectionSummary Component
 *
 * Footer component for TestsetSelectionModal showing selection count,
 * import mode selector (when applicable), and action buttons.
 * Supports both normal load mode and create mode (Build in UI).
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
    warningMessage,
    hasWarning = false,
    isCreateMode = false,
    createDisabled = false,
    createLoading = false,
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

    // Create mode: show "Create & Load" button, no selection count
    if (isCreateMode) {
        return (
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-end">
                    <Space>
                        <Button onClick={onCancel}>Cancel</Button>
                        <Button
                            type="primary"
                            onClick={onConfirm}
                            disabled={createDisabled}
                            loading={createLoading}
                        >
                            Create &amp; Load
                        </Button>
                    </Space>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Compatibility warning */}
            {hasWarning && warningMessage && (
                <div
                    className={`border ${borderColors.default} rounded-md p-3 ${statusColors.warningBg}`}
                >
                    <Text type="warning">{warningMessage}</Text>
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
                    <Button
                        type="primary"
                        danger={hasWarning}
                        onClick={onConfirm}
                        disabled={confirmDisabled}
                    >
                        {confirmText}
                    </Button>
                </Space>
            </div>
        </div>
    )
}
