import {memo} from "react"
import {Button, Typography} from "antd"
import {useStyles} from "./styles"

interface PlaygroundVariantModelConfigTitleProps {
    handleReset: () => void
}

const PlaygroundVariantModelConfigTitle = ({
    handleReset,
}: PlaygroundVariantModelConfigTitleProps) => {
    const classes = useStyles()
    return (
        <div className="flex items-center gap-6 justify-between">
            <Typography.Text className={classes.title}>Model Parameters</Typography.Text>
            <Button onClick={handleReset}>Reset default</Button>
        </div>
    )
}

export default memo(PlaygroundVariantModelConfigTitle)
