import React, {useMemo} from "react"

import clsx from "clsx"

import {EditorProvider} from "@/oss/components/Editor/Editor"
import SimpleDropdownSelect from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/SimpleDropdownSelect"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

interface MessageEditorProps {
    role: string
    text: string
    disabled?: boolean
    className?: string
    editorClassName?: string
    headerClassName?: string
    placeholder?: string
    onChangeRole?: (v: string) => void
    onChangeText?: (v: string) => void
    headerRight?: React.ReactNode
    footer?: React.ReactNode
    noProvider?: boolean
    roleOptions?: {label: string; value: string}[]
    enableTokens?: boolean
}

const MessageEditor: React.FC<MessageEditorProps> = ({
    id,
    role,
    text,
    disabled,
    className,
    editorClassName,
    headerClassName,
    footerClassName,
    placeholder,
    onChangeRole,
    onChangeText,
    headerRight,
    headerBottom,
    footer,
    isJSON,
    isTool,
    noProvider,
    roleOptions,
    enableTokens,
    ...props
}) => {
    // TODO: REPLACE WITH METADATA SELECTOR
    const selectOptions = useMemo(
        () =>
            roleOptions ?? [
                {label: "user", value: "user"},
                {label: "assistant", value: "assistant"},
                {label: "system", value: "system"},
                {label: "tool", value: "tool"},
            ],
        [roleOptions],
    )

    return (
        <SharedEditor
            id={id}
            header={
                <div className={clsx("w-full flex flex-col", headerClassName)}>
                    <div
                        className={clsx(
                            "w-full flex items-center justify-between",
                            headerClassName,
                        )}
                    >
                        <SimpleDropdownSelect
                            value={role}
                            options={selectOptions}
                            onChange={(v) => onChangeRole?.(v)}
                            disabled={disabled}
                            className="message-user-select"
                        />
                        {headerRight}
                    </div>
                    {headerBottom}
                </div>
            }
            editorType="border"
            initialValue={text}
            handleChange={(v: string) => onChangeText?.(v)}
            editorClassName={editorClassName}
            placeholder={placeholder}
            disabled={disabled}
            className={clsx("relative flex flex-col gap-1 rounded-[theme(spacing.2)]", className)}
            footer={footer}
            {...props}
            editorProps={{
                codeOnly: isJSON,
                // disabled: isTool,
                noProvider: true,
                enableTokens: Boolean(enableTokens),
                // tokens: variables,
                showToolbar: false,
            }}
            noProvider={true}
        />
    )
}

const MessageEditorWrapper = ({isJSON, ...props}) => {
    return (
        <EditorProvider
            codeOnly={props.isTool || isJSON}
            enableTokens={Boolean(props.enableTokens)}
            showToolbar={false}
            id={`${props.id}-${isJSON}`}
        >
            <MessageEditor isJSON={isJSON} {...props} />
        </EditorProvider>
    )
}

export default MessageEditorWrapper
