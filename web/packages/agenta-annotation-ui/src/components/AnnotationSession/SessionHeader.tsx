import type {AnnotationProgress} from "@agenta/annotation"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Progress} from "antd"

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

            <span className="flex-1 min-w-0 truncate font-semibold">{queueName}</span>

            <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {progress.completed} / {progress.total} complete
                </span>
                <Progress percent={percent} size="small" className="w-32 mb-0" showInfo={false} />
            </div>
        </div>
    )
}

export default SessionHeader
