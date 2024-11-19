import {copyToClipboard} from "@/lib/helpers/copyToClipboard"
import {CheckOutlined, CopyOutlined} from "@ant-design/icons"
import {Button, notification} from "antd"
import React, {ComponentProps, useState} from "react"

type Props = {
    text: string
    buttonText?: string | null
    icon?: boolean
    stopPropagation?: boolean
}

const CopyButton: React.FC<Props & ComponentProps<typeof Button>> = ({
    text,
    buttonText = "Copy",
    icon = false,
    stopPropagation = false,
    ...props
}) => {
    const [buttonIcon, setButtonIcon] = useState(<CopyOutlined />)

    return (
        <Button
            icon={icon && buttonIcon}
            {...props}
            onClick={async (e) => {
                if (stopPropagation) {
                    e.stopPropagation()
                }
                if (text === "") return
                const copied = await copyToClipboard(text)
                if (copied) {
                    notification.success({
                        message: "Copied to clipboard!",
                    })
                    setButtonIcon(<CheckOutlined />)
                    setTimeout(() => {
                        setButtonIcon(<CopyOutlined />)
                    }, 3000)
                }
            }}
        >
            {buttonText}
        </Button>
    )
}

export default CopyButton
