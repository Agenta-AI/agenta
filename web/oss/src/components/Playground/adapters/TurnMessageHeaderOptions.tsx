import {memo, useCallback, useMemo, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    ArrowClockwise,
    ArrowsOutLineHorizontal,
    CaretDown,
    CaretUp,
    Check,
    Copy,
    FileArchive,
    MarkdownLogoIcon,
    MinusCircle,
    Image as PhImage,
    TextAa,
} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
import {Dropdown} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"

import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import {markdownViewAtom} from "@/oss/components/Editor/state/assets/atoms"
import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import TestsetDrawerButton from "@/oss/components/Playground/Components/Drawers/TestsetDrawer"
import RepetitionNavigation from "@/oss/components/Playground/Components/PlaygroundGenerations/assets/RepetitionNavigation"

export interface TurnMessageHeaderOptionsProps {
    id: string
    className?: string
    messageId?: string
    text?: any
    disabled?: boolean
    minimized?: boolean
    isMessageDeletable?: boolean
    allowFileUpload?: boolean
    uploadCount?: number
    documentCount?: number
    hideMarkdownToggle?: boolean
    hideAddToTestset?: boolean
    viewOnly?: boolean
    resultHashes?: string[]
    repetitionProps?: any
    onViewAllRepeats?: () => void
    actions?: {
        onRerun?: () => void
        onDelete?: () => void
        onMinimize?: () => void
        onClickTestsetDrawer?: () => void
        onAddUploadSlot?: () => void
        onAddDocumentSlot?: () => void
    }
    children?: React.ReactNode
}

export const getTextContent = (content: any) => {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        const value = content.filter(
            (part: any) => part.type?.value === "text" || part.type === "text",
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
    minimized,
    isMessageDeletable,
    allowFileUpload = false,
    uploadCount,
    documentCount,
    hideMarkdownToggle,
    viewOnly,
    resultHashes,
    children,
    hideAddToTestset = false,
    repetitionProps,
    onViewAllRepeats,
    actions,
    ...props
}: TurnMessageHeaderOptionsProps) => {
    const [editor] = useLexicalComposerContext()
    const [markdownView] = useAtom(markdownViewAtom(id))

    const {
        onRerun,
        onDelete,
        onMinimize,
        onClickTestsetDrawer,
        onAddUploadSlot,
        onAddDocumentSlot,
    } = actions || {}

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

    return (
        <div
            className={clsx(
                "flex items-center gap-1 relative invisible group-hover/item:visible",
                className,
            )}
        >
            {repetitionProps && <RepetitionNavigation {...repetitionProps} />}
            {onViewAllRepeats && (
                <EnhancedButton
                    icon={<ArrowsOutLineHorizontal size={12} />}
                    size="small"
                    type="text"
                    onClick={onViewAllRepeats}
                    tooltipProps={{title: "Expand results"}}
                    disabled={!resultHashes || resultHashes.length === 0}
                />
            )}
            {onRerun ? (
                <EnhancedButton
                    icon={<ArrowClockwise size={14} />}
                    type="text"
                    onClick={onRerun}
                    disabled={!resultHashes || resultHashes.length === 0}
                    tooltipProps={{title: "Re-run"}}
                />
            ) : null}

            {!hideAddToTestset && (
                <TestsetDrawerButton
                    tooltipProps={{title: "Add to testset"}}
                    type="text"
                    resultHashes={resultHashes}
                    onClickTestsetDrawer={onClickTestsetDrawer}
                    messageId={messageId}
                    disabled={!resultHashes || resultHashes.length === 0}
                />
            )}

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
                        <EnhancedButton
                            icon={<FileArchive size={14} />}
                            type="text"
                            tooltipProps={{title: "Add attachment"}}
                            disabled={attachmentButtonDisabled}
                        />
                    </span>
                </Dropdown>
            ) : null}

            <EnhancedButton
                icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                type="text"
                onClick={onCopyText}
                tooltipProps={{title: isCopied ? "Copied" : "Copy"}}
            />

            {!hideMarkdownToggle && (
                <EnhancedButton
                    icon={!markdownView ? <TextAa size={14} /> : <MarkdownLogoIcon size={14} />}
                    type="text"
                    onClick={() => {
                        editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
                    }}
                    tooltipProps={{title: !markdownView ? "Preview text" : "Preview markdown"}}
                />
            )}

            {/* {!viewOnly && onDelete ? ( */}
            <EnhancedButton
                icon={<MinusCircle size={14} />}
                type="text"
                onClick={onDelete}
                disabled={!onDelete}
                tooltipProps={{title: "Remove"}}
            />
            {/* ) : null} */}

            <EnhancedButton
                icon={!minimized ? <CaretDown size={14} /> : <CaretUp size={14} />}
                type="text"
                onClick={onMinimize}
                disabled={disabled}
                tooltipProps={{title: minimized ? "Minimize" : "Maximize"}}
            />

            {children}
        </div>
    )
}

export default memo(TurnMessageHeaderOptions)
