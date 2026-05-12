import type {AnnotationProgress} from "@agenta/annotation"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Progress, Typography} from "antd"

interface SessionHeaderProps {
    queueName: string
    progress: AnnotationProgress
    onClose: () => void
}

const SessionHeader = ({queueName, progress, onClose}: SessionHeaderProps) => {
    const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0

    return (
        <div className="flex items-center gap-4 px-4 py-3 border-b border-solid border-[var(--ant-color-border-secondary)]">
            <Button type="text" icon={<ArrowLeft size={16} />} onClick={onClose} />

            <Typography.Text strong className="flex-1 min-w-0 truncate">
                {queueName}
            </Typography.Text>

            <div className="flex items-center gap-3 shrink-0">
                <Typography.Text type="secondary" className="text-xs whitespace-nowrap">
                    {progress.completed} / {progress.total} complete
                </Typography.Text>
                <Progress percent={percent} size="small" className="w-32 mb-0" showInfo={false} />
            </div>
        </div>
    )
}

export default SessionHeader
