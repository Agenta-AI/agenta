/**
 * SelectionSummary Component
 *
 * Footer component for TestsetSelectionModal showing selection count,
 * import mode selector (when applicable), and action buttons.
 * Supports both normal load mode and create mode (Build in UI).
 */

import {borderColors, statusColors} from "@agenta/ui/styles"
import {Button, LoadingButton} from "@agenta/ui/ui"

import type {SelectionSummaryProps} from "../types"

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
                    <span className="text-colorWarningText">{disabledMessage}</span>
                </div>

                {/* Footer row with just cancel button */}
                <div className="flex items-center justify-end">
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            </div>
        )
    }

    // Create mode: show "Create & Load" button, no selection count
    if (isCreateMode) {
        return (
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-end">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={onCancel}>
                            Cancel
                        </Button>
                        <LoadingButton
                            onClick={onConfirm}
                            disabled={createDisabled}
                            loading={createLoading}
                        >
                            Create &amp; Load
                        </LoadingButton>
                    </div>
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
                    <span className="text-colorWarningText">{warningMessage}</span>
                </div>
            )}

            {/* Footer row with count and buttons */}
            <div className="flex items-center justify-between">
                {/* Selection count. antd nests Text inside Text, so the counts carry
                    .ant-typography's own colorText and do NOT inherit the secondary tint.
                    font-semibold is explicit: preflight is off, so a bare <strong> would take
                    the UA's 700 rather than antd's fontWeightStrong 600. */}
                <div>
                    <span className="text-colorTextDescription">
                        <strong className="font-semibold text-colorText">{selectedCount}</strong> of{" "}
                        <strong className="font-semibold text-colorText">{totalCount}</strong>{" "}
                        testcases selected
                    </span>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        variant={hasWarning ? "destructive" : "default"}
                        onClick={onConfirm}
                        disabled={confirmDisabled}
                    >
                        {confirmText}
                    </Button>
                </div>
            </div>
        </div>
    )
}
