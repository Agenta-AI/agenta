import type {ReactNode} from "react"

import {Typography} from "antd"

interface TriggerSectionHeaderProps {
    icon: ReactNode
    title: string
    description: string
    actions: ReactNode
}

export function TriggerSectionHeader({
    icon,
    title,
    description,
    actions,
}: TriggerSectionHeaderProps) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2">
                <span className="mt-0.5 text-colorTextSecondary">{icon}</span>
                <div className="flex flex-col">
                    <Typography.Text strong>{title}</Typography.Text>
                    <Typography.Text type="secondary">{description}</Typography.Text>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </div>
    )
}

interface TriggerEmptyStateProps {
    icon: ReactNode
    title: string
    description: string
    action?: ReactNode
}

export function TriggerEmptyState({icon, title, description, action}: TriggerEmptyStateProps) {
    return (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="text-colorTextTertiary">{icon}</span>
            <Typography.Text strong>{title}</Typography.Text>
            <Typography.Text type="secondary" className="max-w-[380px] text-xs">
                {description}
            </Typography.Text>
            {action ? <div className="mt-1">{action}</div> : null}
        </div>
    )
}
