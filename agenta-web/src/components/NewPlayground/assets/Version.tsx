import {Tag, type TagProps} from "antd"
import clsx from "clsx"

interface Props extends TagProps {
    revision: number | string
    className?: string
}

const Version: React.FC<Props> = ({revision, className, ...props}) => {
    return (
        <Tag
            color="default"
            bordered={false}
            className={clsx("bg-[rgba(5,23,41,0.06)] flex items-center gap-1", className)}
            {...props}
        >
            <div className="w-1.5 h-1.5 bg-[#389E0D] rounded-full" />

            {`v${revision}`}
        </Tag>
    )
}

export default Version
