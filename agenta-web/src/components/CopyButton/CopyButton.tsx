import {copyToClipboard} from "@/lib/helpers/copyToClipboard"
import {CopyOutlined} from "@ant-design/icons"
import {Button} from "antd"
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
        <Button icon={icon && <CopyOutlined />} {...props} onClick={() => copyToClipboard(text)}>
            {buttonText}
        </Button>
    )
}

export default CopyButton
