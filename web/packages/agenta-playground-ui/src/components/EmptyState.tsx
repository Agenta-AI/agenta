/**
 * EmptyState Component
 *
 * Displayed when no runnable has been added to the playground yet.
 */

import {IconTile} from "@agenta/ui/composed"
import {Play, Lightning} from "@phosphor-icons/react"
import {Button, Empty, Space, Typography} from "antd"

const {Text, Title} = Typography

interface EmptyStateProps {
    onAddRunnable: () => void
}

export function EmptyState({onAddRunnable}: EmptyStateProps) {
    return (
        <Empty
            image={
                <IconTile size={40} className="mx-auto">
                    <Play />
                </IconTile>
            }
            description={
                <Space orientation="vertical" size="small">
                    <Title level={4} style={{marginBottom: 0}}>
                        Start your playground
                    </Title>
                    <Text type="secondary" className="block max-w-md">
                        Add an app revision or evaluator to begin. You'll then be able to connect
                        test data and run experiments.
                    </Text>
                </Space>
            }
        >
            <Button type="primary" icon={<Lightning size={14} />} onClick={onAddRunnable}>
                Add App Revision or Evaluator
            </Button>
        </Empty>
    )
}
