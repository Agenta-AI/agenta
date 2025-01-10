import {Tag, Typography} from "antd"
import clsx from "clsx"
import {useStyles} from "../styles"
import {GenerationComparisionOutputHeaderProps} from "./types"
import Version from "@/components/PlaygroundTest/assets/Version"

const GenerationComparisionOutputHeader: React.FC<GenerationComparisionOutputHeaderProps> = ({
    className,
}) => {
    const classes = useStyles()

    return (
        <div className={clsx(classes.title, className)}>
            <Typography>Output A</Typography>
            <Tag color="default" bordered={false}>
                app.v1
            </Tag>
            <Version revision={2} />
        </div>
    )
}

export default GenerationComparisionOutputHeader
