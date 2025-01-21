import {Tag, Typography} from "antd"
import clsx from "clsx"
import {useStyles} from "../styles"
import {GenerationComparisonOutputHeaderProps} from "./types"
import Version from "@/components/NewPlayground/assets/Version"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

const GenerationComparisonOutputHeader: React.FC<GenerationComparisonOutputHeaderProps> = ({
    className,
    variantId,
    indexName,
}) => {
    const {variant} = usePlayground({variantId})
    const classes = useStyles()

    return (
        <div className={clsx(classes.title, className)}>
            <Typography>Output {indexName}</Typography>
            <Tag color="default" className="bg-[rgba(5,23,41,0.06)]" bordered={false}>
                {variant?.variantName}
            </Tag>
            <Version revision={variant?.revision as number} />
        </div>
    )
}

export default GenerationComparisonOutputHeader
