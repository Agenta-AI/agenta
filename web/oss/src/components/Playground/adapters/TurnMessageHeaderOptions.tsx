import {useCallback, memo, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    MinusCircle,
    Copy,
    Check,
    ArrowClockwise,
    CaretDown,
    CaretUp,
    Image as PhImage,
    MarkdownLogoIcon,
    TextAa,
} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtom} from "jotai"

import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import {markdownViewAtom} from "@/oss/components/Editor/state/assets/atoms"
import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
import TestsetDrawerButton from "@/oss/components/Playground/Components/Drawers/TestsetDrawer"

export interface TurnMessageHeaderOptionsProps {
    className?: string
    messageId?: string
    text?: any
    disabled?: boolean
    minimized?: boolean
    isMessageDeletable?: boolean
    allowFileUpload?: boolean
    uploadCount?: number
    hideMarkdownToggle?: boolean
    hideAddToTestset?: boolean
    viewOnly?: boolean
    resultHashes?: string[]
    actions?: {
        onRerun?: () => void
        onDelete?: () => void
        onMinimize?: () => void
        onClickTestsetDrawer?: () => void
        onAddUploadSlot?: () => void
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
    hideMarkdownToggle,
    viewOnly,
    resultHashes,
    actions,
    children,
    hideAddToTestset = false,
    ...props
}: TurnMessageHeaderOptionsProps) => {
    const [editor] = useLexicalComposerContext()
    const [markdownView] = useAtom(markdownViewAtom(id))

    const {onRerun, onDelete, onMinimize, onClickTestsetDrawer, onAddUploadSlot} = actions || {}

    const [isCopied, setIsCopied] = useState(false)

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
                "flex items-center gap-1 invisible group-hover/item:visible",
                className,
            )}
        >
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

            <EnhancedButton
                icon={<PhImage size={14} />}
                type="text"
                onClick={onAddUploadSlot}
                tooltipProps={{title: "Upload Image"}}
                disabled={!allowFileUpload || (uploadCount !== undefined && uploadCount >= 5)}
            />

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
