import {memo, useCallback, useMemo, useState} from "react"

import {MarkdownToggleButton} from "@agenta/ui/chat-message"
import {
    ArrowClockwise,
    ArrowsOutLineHorizontal,
    Check,
    Copy,
    FileArchive,
    Image as PhImage,
    MinusCircle,
} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
import {Button, Dropdown, Tooltip} from "antd"
import clsx from "clsx"

import CollapseToggleButton from "../shared/CollapseToggleButton"

export interface TurnMessageHeaderOptionsProps {
    id: string
    className?: string
    messageId?: string
    text?: unknown
    disabled?: boolean
    collapsed?: boolean
    /** @deprecated Use `collapsed` */
    minimized?: boolean
    isMessageDeletable?: boolean
    allowFileUpload?: boolean
    uploadCount?: number
    documentCount?: number
    hideMarkdownToggle?: boolean
    hideAddToTestset?: boolean
    viewOnly?: boolean
    resultHashes?: string[]
    results?: unknown[]
    repetitionProps?: RepetitionNavProps
    onViewAllRepeats?: () => void
    actions?: {
        onRerun?: () => void
        onDelete?: () => void
        onToggleCollapse?: () => void
        /** @deprecated Use `onToggleCollapse` */
        onMinimize?: () => void
        onClickTestsetDrawer?: () => void
        onAddUploadSlot?: () => void
        onAddDocumentSlot?: () => void
    }
    /** Render slot for testset drawer button (OSS-specific) */
    renderTestsetButton?: (props: {
        messageId?: string
        results?: unknown[]
        resultHashes?: string[]
        onClickTestsetDrawer?: () => void
        disabled: boolean
    }) => React.ReactNode
    /** Render slot for repetition navigation (OSS-specific) */
    renderRepetitionNav?: (props: RepetitionNavProps) => React.ReactNode
    children?: React.ReactNode
}

export interface RepetitionNavProps {
    current: number
    total: number
    onNext: () => void
    onPrev: () => void
}

export const getTextContent = (content: unknown) => {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        const value = content.filter(
            (part: unknown) =>
                typeof part === "object" &&
                part !== null &&
                (((part as {type?: {value?: string}}).type as {value?: string} | undefined)
                    ?.value === "text" ||
                    (part as {type?: string}).type === "text"),
        )
        return value.length > 0
            ? typeof value[0].text === "string"
                ? value[0].text
                : value[0].text?.value
            : ""
    }
    return ""
}

const TurnMessageHeaderOptions = ({
    id,
    className,
    messageId,
    text,
    disabled,
    collapsed,
    minimized,
    allowFileUpload = false,
    uploadCount,
    documentCount,
    hideMarkdownToggle,
    resultHashes,
    results,
    children,
    hideAddToTestset = false,
    repetitionProps,
    onViewAllRepeats,
    actions,
    renderTestsetButton,
    renderRepetitionNav,
}: TurnMessageHeaderOptionsProps) => {
    const {
        onRerun,
        onDelete,
        onToggleCollapse,
        onMinimize,
        onClickTestsetDrawer,
        onAddUploadSlot,
        onAddDocumentSlot,
    } = actions || {}
    const isCollapsed = collapsed ?? minimized ?? false
    const handleToggleCollapse = onToggleCollapse ?? onMinimize

    const [isCopied, setIsCopied] = useState(false)

    const maxImageReached = uploadCount !== undefined && uploadCount >= 5
    const maxDocumentReached = documentCount !== undefined && documentCount >= 5

    const canAddImageUpload = Boolean(onAddUploadSlot) && allowFileUpload && !maxImageReached
    const canAddDocumentUpload =
        Boolean(onAddDocumentSlot) && allowFileUpload && !maxDocumentReached
    const attachmentButtonDisabled = !canAddImageUpload && !canAddDocumentUpload

    const attachmentMenuItems = useMemo<NonNullable<MenuProps["items"]>>(() => {
        const items: NonNullable<MenuProps["items"]> = []
        if (onAddUploadSlot) {
            items.push({
                key: "image",
                disabled: !canAddImageUpload,
                label: (
                    <span className="flex items-center gap-1">
                        <PhImage size={12} />
                        <span>Upload image</span>
                    </span>
                ),
            })
        }
        if (onAddDocumentSlot) {
            items.push({
                key: "document",
                disabled: !canAddDocumentUpload,
                label: (
                    <span className="flex items-center gap-1">
                        <FileArchive size={12} />
                        <span>Attach document</span>
                    </span>
                ),
            })
        }
        return items
    }, [onAddUploadSlot, onAddDocumentSlot, canAddImageUpload, canAddDocumentUpload])

    const handleAttachmentMenuClick = useCallback<NonNullable<MenuProps["onClick"]>>(
        ({key}) => {
            if (key === "image" && canAddImageUpload) {
                onAddUploadSlot?.()
            } else if (key === "document" && canAddDocumentUpload) {
                onAddDocumentSlot?.()
            }
        },
        [onAddDocumentSlot, onAddUploadSlot, canAddDocumentUpload, canAddImageUpload],
    )

    const onCopyText = useCallback(() => {
        const value = getTextContent(text || "")
        if (value) {
            setIsCopied(true)
            navigator.clipboard.writeText(value)
            setTimeout(() => setIsCopied(false), 1000)
        }
    }, [text])

    const testsetDisabled =
        (!results || results.length === 0) && (!resultHashes || resultHashes.length === 0)

    return (
        <div
            className={clsx(
                "flex items-center gap-1 relative invisible group-hover/item:visible",
                className,
            )}
        >
            {repetitionProps && renderRepetitionNav && renderRepetitionNav(repetitionProps)}

            {onViewAllRepeats && (
                <Tooltip title="Expand results">
                    <Button
                        icon={<ArrowsOutLineHorizontal size={12} />}
                        size="small"
                        type="text"
                        onClick={onViewAllRepeats}
                        disabled={!resultHashes || resultHashes.length === 0}
                    />
                </Tooltip>
            )}

            {onRerun ? (
                <Tooltip title="Re-run">
                    <Button
                        icon={<ArrowClockwise size={14} />}
                        type="text"
                        onClick={onRerun}
                        disabled={!resultHashes || resultHashes.length === 0}
                    />
                </Tooltip>
            ) : null}

            {!hideAddToTestset &&
                renderTestsetButton &&
                renderTestsetButton({
                    messageId,
                    results,
                    resultHashes,
                    onClickTestsetDrawer,
                    disabled: testsetDisabled,
                })}

            {attachmentMenuItems.length > 0 ? (
                <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                        items: attachmentMenuItems,
                        onClick: handleAttachmentMenuClick,
                    }}
                    disabled={attachmentButtonDisabled}
                >
                    <span className="inline-flex">
                        <Tooltip title="Add attachment">
                            <Button
                                icon={<FileArchive size={14} />}
                                type="text"
                                disabled={attachmentButtonDisabled}
                            />
                        </Tooltip>
                    </span>
                </Dropdown>
            ) : null}

            <Tooltip title={isCopied ? "Copied" : "Copy"}>
                <Button
                    icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                    type="text"
                    onClick={onCopyText}
                />
            </Tooltip>

            {!hideMarkdownToggle && <MarkdownToggleButton id={id} />}

            <Tooltip title="Remove">
                <Button
                    icon={<MinusCircle size={14} />}
                    type="text"
                    onClick={onDelete}
                    disabled={!onDelete}
                />
            </Tooltip>

            <CollapseToggleButton
                collapsed={isCollapsed}
                onToggle={handleToggleCollapse}
                disabled={disabled}
            />

            {children}
        </div>
    )
}

export default memo(TurnMessageHeaderOptions)
