/**
 * EmptyState Component
 *
 * Displayed when no runnable has been added to the playground yet.
 */

import {Button, EmptyState as EmptyStateBase} from "@agenta/ui/ui"
import {Play, Lightning} from "@phosphor-icons/react"

interface EmptyStateProps {
    onAddRunnable: () => void
}

export function EmptyState({onAddRunnable}: EmptyStateProps) {
    return (
        <EmptyStateBase
            image={
                <div className="w-16 h-16 bg-colorFillQuaternary rounded-full flex items-center justify-center mx-auto">
                    <Play size={32} weight="light" className="text-colorTextDescription" />
                </div>
            }
            description={
                <div className="flex flex-col gap-2">
                    {/* mt-[1.33em] reproduces antd Typography.Title's heading margin-top
                        (21.28px at 16px) — the original set marginBottom:0 but kept the top. */}
                    <div className="mt-[1.33em] text-base font-semibold text-colorTextHeading">
                        Start your playground
                    </div>
                    <span className="block max-w-md text-colorTextDescription">
                        Add an app revision or evaluator to begin. You'll then be able to connect
                        test data and run experiments.
                    </span>
                </div>
            }
        >
            <Button onClick={onAddRunnable}>
                <Lightning size={14} />
                Add App Revision or Evaluator
            </Button>
        </EmptyStateBase>
    )
}
