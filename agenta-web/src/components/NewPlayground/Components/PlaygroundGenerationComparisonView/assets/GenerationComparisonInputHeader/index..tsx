import {Typography} from "antd"
import clsx from "clsx"
import {useStyles} from "../styles"
import {GenerationComparisonInputHeaderProps} from "./types"

const GenerationComparisonInputHeader: React.FC<GenerationComparisonInputHeaderProps> = ({
    className,
}) => {
    const classes = useStyles()

    return (
        <div className={clsx(classes.title, className)}>
            <Typography>Input</Typography>
        </div>
    )
}

export default GenerationComparisonInputHeader
