import {copyToClipboard} from "@/lib/helpers/copyToClipboard"
import {Button, notification} from "antd"

const CopyButton = (props: any) => {
    const {text, target} = props

    return (
        <Button
            {...props}
            onClick={async (e: React.MouseEvent) => {
                if (target === "") return
                const copied = await copyToClipboard(e, target)
                if (copied)
                    notification.success({
                        message: "Copied",
                        duration: 5,
                    })
            }}
        >
            {text}
        </Button>
    )
}

export default CopyButton
