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
            className={clsx("bg-[rgba(5,23,41,0.06)]", className)}
            {...props}
        >
            {`v${revision}`}
        </Tag>
    )
}

export default Version
