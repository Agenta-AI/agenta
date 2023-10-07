import {copyToClipboard} from "@/lib/helpers/copyToClipboard"
import {CopyOutlined} from "@ant-design/icons"
import {Button, notification} from "antd"
import React, {ComponentProps} from "react"

type Props = {
    text: string
    buttonText?: string | null
    icon?: boolean
}

const CopyButton: React.FC<Props & ComponentProps<typeof Button>> = ({
    text,
    buttonText = "Copy",
    icon = false,
    ...props
}) => {
    return (
        <Button
            icon={icon && <CopyOutlined />}
            {...props}
            onClick={async (e: React.MouseEvent) => {
                if (text === "") return
                const copied = await copyToClipboard(e, text)
                if (copied)
                    notification.success({
                        message: "Copied to clipboard!",
                    })
            }}
        >
            {buttonText}
        </Button>
    )
}

export default CopyButton
