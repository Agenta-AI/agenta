import {Typography} from "antd"
import clsx from "clsx"
import {useStyles} from "./styles"
import {PlaygroundComparisionGenerationInputHeaderProps} from "./types"

const PlaygroundComparisionGenerationInputHeader: React.FC<
    PlaygroundComparisionGenerationInputHeaderProps
> = ({className}) => {
    const classes = useStyles()

    return (
        <div className={clsx(classes.title, className)}>
            <Typography>Input</Typography>
        </div>
    )
}

export default PlaygroundComparisionGenerationInputHeader
