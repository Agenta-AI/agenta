/**
 * EmptyState Component
 *
 * Displayed when no runnable has been added to the playground yet.
 */

import {Button} from "@agenta/primitive-ui/components/button"
import {Play, Lightning} from "@phosphor-icons/react"
import {Empty, Space} from "antd"

interface EmptyStateProps {
    onAddRunnable: () => void
}

export function EmptyState({onAddRunnable}: EmptyStateProps) {
    return (
        <Empty
            image={
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                    <Play size={32} weight="light" className="text-gray-400" />
                </div>
            }
            description={
                <Space orientation="vertical" size="small">
                    <h4 style={{marginBottom: 0}} className="text-base font-semibold leading-snug">
                        Start your playground
                    </h4>
                    <span className="block max-w-md text-muted-foreground">
                        Add an app revision or evaluator to begin. You'll then be able to connect
                        test data and run experiments.
                    </span>
                </Space>
            }
        >
            <Button onClick={onAddRunnable}>
                {<Lightning size={14} />}
                Add App Revision or Evaluator
            </Button>
        </Empty>
    )
}
