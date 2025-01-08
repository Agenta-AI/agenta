import {Button} from "antd"
import {MinusCircle, Copy, Image} from "@phosphor-icons/react"
import {PromptMessageContentOptionsProps} from "./types"
import clsx from "clsx"

const PromptMessageContentOptions = ({
    deleteMessage,
    messageId,
    className,
}: PromptMessageContentOptionsProps) => {
    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <Button icon={<Image size={14} />} type="text" />
            <Button icon={<Copy size={14} />} type="text" />
            <Button
                icon={<MinusCircle size={14} />}
                type="text"
                onClick={() => deleteMessage(messageId)}
            />
        </div>
    )
}

export default PromptMessageContentOptions
