import {ComponentProps, useState} from "react"

import {Button, notification} from "antd"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {Check, Copy} from "@phosphor-icons/react"

interface Props {
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
    const [buttonIcon, setButtonIcon] = useState(<Copy size={14} className="mt-0.5" />)

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
                    setButtonIcon(<Check size={14} />)
                    setTimeout(() => {
                        setButtonIcon(<Copy size={14} />)
                    }, 3000)
                }
            }}
        >
            {buttonText}
        </Button>
    )
}

export default CopyButton
