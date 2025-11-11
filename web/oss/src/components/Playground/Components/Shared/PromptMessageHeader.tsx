import React, {useMemo} from "react"

import clsx from "clsx"

import PlaygroundVariantPropertyControl from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl"
import PromptMessageContentOptions from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"

interface PromptMessageHeaderProps {
    variantId?: string
    rowId?: string
    messageId?: string

    isFunction: boolean
    isTool: boolean
    disabled?: boolean
    minimized?: boolean
    className?: string
    headerClassName?: string

    rolePropertyId?: string
    contentPropertyId?: string

    // function-mode extras
    functionNamePropertyId?: string
    toolCallIdPropertyId?: string

    allowFileUpload?: boolean
    uploadCount?: number
    resultHashes?: string[]
    viewOnly?: boolean
    hideMarkdownToggle?: boolean

    actions?: {
        onRerun?: () => void
        onDelete?: () => void
        onMinimize?: () => void
        onAddUploadSlot?: () => void
        onClickTestsetDrawer?: () => void
    }

    children?: React.ReactNode
}

const PromptMessageHeader: React.FC<PromptMessageHeaderProps> = ({
    id,
    variantId,
    rowId,
    messageId,
    isFunction,
    isTool,
    disabled,
    minimized,
    className,
    headerClassName,
    rolePropertyId,
    contentPropertyId,
    functionNamePropertyId,
    toolCallIdPropertyId,
    allowFileUpload,
    uploadCount,
    resultHashes,
    viewOnly,
    hideMarkdownToggle,
    actions,
    children,
}) => {
    const headerCls = useMemo(
        () => clsx("w-full flex items-center justify-between", headerClassName),
        [headerClassName],
    )

    const commonRight = (
        <PromptMessageContentOptions
            id={id}
            className="invisible group-hover/item:visible"
            propertyId={contentPropertyId}
            variantId={variantId}
            messageId={messageId}
            isMessageDeletable={Boolean(actions?.onDelete)}
            disabled={disabled}
            runnable={Boolean(actions?.onRerun)}
            minimized={Boolean(minimized)}
            actions={{
                deleteMessage: actions?.onDelete,
                rerunMessage: actions?.onRerun,
                minimize: actions?.onMinimize,
                onClickTestsetDrawer: actions?.onClickTestsetDrawer,
                handleAddUploadSlot: actions?.onAddUploadSlot,
            }}
            allowFileUpload={allowFileUpload}
            uploadCount={uploadCount}
            hideMarkdownToggle={hideMarkdownToggle}
            viewOnly={viewOnly}
        >
            {children}
        </PromptMessageContentOptions>
    )

    if (isFunction) {
        return (
            <div className={clsx("w-full flex flex-col items-center gap-1", headerClassName)}>
                <div className={headerCls}>
                    {rolePropertyId ? (
                        <PlaygroundVariantPropertyControl
                            propertyId={rolePropertyId}
                            variantId={variantId}
                            rowId={rowId}
                            as="SimpleDropdownSelect"
                            className="message-user-select"
                            disabled={disabled}
                        />
                    ) : null}
                    {!disabled && commonRight}
                </div>
                <div className="w-full pb-2 pt-0 flex items-center justify-between">
                    {functionNamePropertyId ? (
                        <PlaygroundVariantPropertyControl
                            propertyId={functionNamePropertyId}
                            variantId={variantId}
                            rowId={rowId}
                            as="SimpleInput"
                            className="message-user-select px-0"
                            disabled={disabled}
                            placeholder="Function name"
                        />
                    ) : null}
                    {toolCallIdPropertyId ? (
                        <PlaygroundVariantPropertyControl
                            propertyId={toolCallIdPropertyId}
                            variantId={variantId}
                            rowId={rowId}
                            as="SimpleInput"
                            className="message-user-select px-0 text-right"
                            disabled={disabled}
                            placeholder="Tool call id"
                        />
                    ) : null}
                </div>
            </div>
        )
    }

    if (isTool) {
        return (
            <div className={clsx("pt-2 w-full flex flex-col items-center gap-1", headerClassName)}>
                <div className={headerCls}>
                    {rolePropertyId ? (
                        <PlaygroundVariantPropertyControl
                            propertyId={rolePropertyId}
                            variantId={variantId}
                            rowId={rowId}
                            as="SimpleDropdownSelect"
                            className="message-user-select"
                            disabled={disabled}
                        />
                    ) : null}
                    {!disabled && commonRight}
                </div>
            </div>
        )
    }

    // Normal message header
    return (
        <div className={clsx("w-full flex items-center justify-between", headerClassName)}>
            {rolePropertyId ? (
                <PlaygroundVariantPropertyControl
                    propertyId={rolePropertyId}
                    variantId={variantId}
                    rowId={rowId}
                    messageId={messageId}
                    as="SimpleDropdownSelect"
                    className="message-user-select"
                    disabled={disabled || viewOnly}
                />
            ) : null}
            {!disabled && commonRight}
        </div>
    )
}

export default React.memo(PromptMessageHeader)
