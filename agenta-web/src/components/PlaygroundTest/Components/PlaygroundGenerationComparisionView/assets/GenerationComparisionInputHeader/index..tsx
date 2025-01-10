import {Typography} from "antd"
import clsx from "clsx"
import {useStyles} from "../styles"
import {GenerationComparisionInputHeaderProps} from "./types"

const GenerationComparisionInputHeader: React.FC<GenerationComparisionInputHeaderProps> = ({
    className,
}) => {
    const classes = useStyles()

    return (
        <div className={clsx(classes.title, className)}>
            <Typography>Input</Typography>
        </div>
    )
}

export default GenerationComparisionInputHeader
