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
                "w-full h-[44px] border-0 border-b border-r border-solid border-colorBorderSecondary px-4 flex gap-2 items-center text-base font-medium bg-white",
                className,
            )}
        >
            <Typography>Input</Typography>
        </div>
    )
}

export default GenerationComparisonInputHeader
