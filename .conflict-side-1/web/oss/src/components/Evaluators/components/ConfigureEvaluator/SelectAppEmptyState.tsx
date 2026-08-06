/**
 * SelectAppEmptyState
 *
 * Centered empty state shown in the run/generation panel when the evaluator is
 * in "Run on an app" mode but no app is connected yet. The evaluator can't run
 * until an app is picked, so this guides the user to the one action that
 * unblocks them. Shared by the evaluator playground page and the
 * evaluator-creation drawer so both read identically.
 */

import {EntityPicker} from "@agenta/entity-ui"
import type {
    EntitySelectionAdapter,
    WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {AppstoreOutlined} from "@ant-design/icons"
import {Typography, theme} from "antd"

interface SelectAppEmptyStateProps {
    adapter: EntitySelectionAdapter<WorkflowRevisionSelectionResult>
    onSelect: (selection: WorkflowRevisionSelectionResult) => void
    selectedAppLabel?: string | null
}

const SelectAppEmptyState = ({adapter, onSelect, selectedAppLabel}: SelectAppEmptyStateProps) => {
    const {token} = theme.useToken()

    return (
        <div className="flex max-w-[340px] flex-col items-center gap-4">
            <div
                className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{background: token.colorPrimaryBg, color: token.colorPrimary}}
            >
                <AppstoreOutlined style={{fontSize: 26}} />
            </div>
            <div className="flex flex-col gap-1 text-center">
                <Typography.Text className="text-[15px] font-semibold">
                    Select an app to run the evaluator on
                </Typography.Text>
                <Typography.Text type="secondary" className="text-[13px] leading-snug">
                    The evaluator grades this app&apos;s output. Pick which app to run, then fill
                    its inputs or load a test set.
                </Typography.Text>
            </div>
            <EntityPicker<WorkflowRevisionSelectionResult>
                variant="popover-cascader"
                adapter={adapter}
                onSelect={onSelect}
                size="middle"
                placeholder={selectedAppLabel ?? "Select app"}
            />
        </div>
    )
}

export default SelectAppEmptyState
