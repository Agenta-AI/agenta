import React from "react"

import PromptMessageConfig from "@/oss/components/Playground/Components/PromptMessageConfig"

interface Props {
    variantId?: string
    rowId: string
    turnId: string
    message: any
    onRerun: () => void
    onDelete: () => void
    onChange: (val: string) => void
}

const UserMessageBlock: React.FC<Props> = ({
    variantId,
    rowId,
    turnId,
    message,
    messageProps,
    onRerun,
    onDelete,
    onChange,
}) => {
    return (
        <PromptMessageConfig
            variantId={variantId as string}
            rowId={rowId}
            messageId={`${turnId}-user`}
            message={message as any}
            placeholder="Type a message..."
            rerunMessage={() => onRerun()}
            deleteMessage={() => onDelete()}
            isMessageDeletable={true}
            handleChange={(val: string) => onChange(val)}
            runnable={false}
            allowFileUpload={true}
            className="w-full"
            {...messageProps}
        />
    )
}

export default UserMessageBlock
