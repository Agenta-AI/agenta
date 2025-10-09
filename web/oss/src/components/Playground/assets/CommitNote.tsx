import {Dispatch, memo, SetStateAction} from "react"

import {Input, Typography} from "antd"

import {COMMIT_MESSAGE_MAX_LENGTH} from "@/oss/config/constants"

const CommitNote = ({
    note,
    setNote,
    text,
    className,
    textareaClassName,
    helpText,
}: {
    note: string
    setNote: Dispatch<SetStateAction<string>>
    text?: string | React.ReactNode
    className?: string
    textareaClassName?: string
    helpText?: string
}) => {
    const resolvedTextareaClassName = textareaClassName ?? "mb-4"

    return (
        <div className={`flex flex-col gap-1 ${className ?? ""}`}>
            <Typography.Text className="font-medium">
                {text || "Notes"} <span className="text-[#758391]">(optional)</span>
            </Typography.Text>
            <Input.TextArea
                placeholder="Add a brief summary of what changed"
                className={`w-full ${resolvedTextareaClassName}`.trim()}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoSize={{minRows: 2, maxRows: 4}}
                showCount
                maxLength={COMMIT_MESSAGE_MAX_LENGTH}
            />
            {/* HelpText removed in favor of tooltips in parent */}
        </div>
    )
}

export default memo(CommitNote)
