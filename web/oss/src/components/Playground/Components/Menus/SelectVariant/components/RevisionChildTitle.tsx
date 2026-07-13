import {useCallback, useRef, useState} from "react"

import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {dayjs} from "@agenta/shared/utils"
import {Check, CopySimple} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

interface RevisionMetadata {
    message?: string | null
    commitMessage?: string | null
    created_at?: string | null
    createdAt?: string | null
    updated_at?: string | null
    updatedAt?: string | null
}

interface RevisionChildTitleProps {
    revisionId: string
    variantName: string
    version: number
    variant: unknown
    isDisabled: boolean
    showLatestTag: boolean
    showAsCompare: boolean
    showBadges?: boolean
    linear?: boolean
    isCurrent?: boolean
    onCreateLocalCopy: (revisionId: string, e: React.MouseEvent) => void
    latestRevisionId?: string | null
}

const OverflowMessage = ({message}: {message: string}) => {
    const textRef = useRef<HTMLSpanElement>(null)
    const [open, setOpen] = useState(false)

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen) {
            setOpen(false)
            return
        }

        const text = textRef.current
        setOpen(Boolean(text && text.scrollWidth > text.clientWidth))
    }, [])

    return (
        <Tooltip
            open={open}
            onOpenChange={handleOpenChange}
            placement="left"
            mouseEnterDelay={0.5}
            styles={{root: {maxWidth: 300}}}
            title={
                <span className="line-clamp-6 whitespace-pre-wrap break-words text-xs leading-relaxed">
                    {message}
                </span>
            }
        >
            <span
                ref={textRef}
                className="block w-full min-w-0 truncate text-xs text-[var(--ant-color-text-secondary)]"
            >
                {message}
            </span>
        </Tooltip>
    )
}

const RevisionChildTitle = ({
    revisionId,
    variantName,
    version,
    variant,
    isDisabled,
    showLatestTag,
    showAsCompare,
    showBadges = true,
    linear = false,
    isCurrent = false,
    onCreateLocalCopy,
    latestRevisionId,
}: RevisionChildTitleProps) => {
    const isLatest = !!latestRevisionId && revisionId === latestRevisionId
    const revision = variant as RevisionMetadata
    const commitMessage = revision.message?.trim() || revision.commitMessage?.trim()
    const timestamp =
        revision.created_at ?? revision.createdAt ?? revision.updated_at ?? revision.updatedAt
    const date = timestamp ? dayjs(timestamp) : null
    const relativeTime = date?.isValid() ? date.fromNow() : null
    const exactTime = date?.isValid() ? date.format("MMM D, YYYY, h:mm A") : null

    if (linear) {
        return (
            <div className="group/revision grid h-9 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-1.5">
                <span className="shrink-0 rounded-md bg-[var(--ant-color-fill-secondary)] px-2 py-1 text-xs font-medium text-[var(--ant-color-text)]">
                    v{version}
                </span>
                {commitMessage ? (
                    <OverflowMessage message={commitMessage} />
                ) : (
                    <span className="block w-full min-w-0 truncate text-xs italic text-[var(--ant-color-text-tertiary)]">
                        No commit message
                    </span>
                )}
                {relativeTime ? (
                    <time
                        className="shrink-0 whitespace-nowrap text-[11px] text-[var(--ant-color-text-tertiary)]"
                        dateTime={timestamp ?? undefined}
                        title={exactTime ?? undefined}
                    >
                        {relativeTime}
                    </time>
                ) : null}
                {isLatest && showLatestTag ? (
                    <span className="shrink-0 text-[10px] font-medium text-[var(--ant-color-primary)]">
                        Latest
                    </span>
                ) : null}
                {isCurrent ? (
                    <Check
                        size={14}
                        weight="bold"
                        className="shrink-0 text-[var(--ant-color-primary)]"
                        aria-label="Current revision"
                    />
                ) : null}
            </div>
        )
    }

    return (
        <div
            className={`flex items-center justify-between h-[32px] pl-1.5 pr-0 group/revision ${isDisabled ? "opacity-50" : ""}`}
        >
            <VariantDetailsWithStatus
                className="w-full [&_.environment-badges]:mr-2"
                variantName={variantName}
                revision={version}
                variant={variant as any}
                hideName
                showBadges={showBadges}
                showLatestTag={showLatestTag}
                isLatest={isLatest}
            />
            {showAsCompare && (
                <Tooltip title="Create local copy for comparison">
                    <Button
                        type="text"
                        size="small"
                        icon={<CopySimple size={14} />}
                        className="opacity-0 group-hover/revision:opacity-100 transition-opacity mr-1"
                        onClick={(e) => onCreateLocalCopy(revisionId, e)}
                        data-tour="compare-toggle"
                    />
                </Tooltip>
            )}
        </div>
    )
}

export default RevisionChildTitle
