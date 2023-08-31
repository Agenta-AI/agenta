import {copyToClipboard} from "@/lib/helpers/copyToClipboard"
import {Button, notification} from "antd"
import {createUseStyles} from "react-jss"

interface CopyButtonProps {
    text: string
    target: string
    disabled?: boolean
}

const useStyles = createUseStyles({
    copyBtn: {
        marginLeft: "15px",
    },
})

const CopyButton: React.FC<CopyButtonProps> = ({text, target, disabled = false}) => {
    const classes = useStyles()
    return (
        <Button
            type="primary"
            size="middle"
            onClick={async (e: React.MouseEvent) => {
                if (target === "") return
                const copied = await copyToClipboard(e, target)
                if (copied)
                    notification.success({
                        message: "Copied",
                        duration: 5,
                    })
            }}
            className={classes.copyBtn}
            disabled={disabled}
        >
            {text}
        </Button>
    )
}

export default CopyButton
