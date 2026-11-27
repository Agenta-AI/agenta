import {Typography} from "antd"
import clsx from "clsx"

interface GenerationComparisonInputHeaderProps {
    className?: string
}

const GenerationComparisonInputHeader: React.FC<GenerationComparisonInputHeaderProps> = ({
    className,
}) => {
    return (
        <div
            className={clsx(
                "w-full h-11 border-0 border-b border-r border-solid border-border-muted px-4 flex gap-2 items-center text-title bg-background",
                className,
            )}
        >
            <Typography>Input</Typography>
        </div>
    )
}

export default GenerationComparisonInputHeader
