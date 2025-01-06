import {Tag, type TagProps} from "antd"
import clsx from "clsx"

interface Props extends TagProps {
    revision: number | string
    className?: string
    type?: "variant" | "deployment"
    deploymentName?: string
}

const Version: React.FC<Props> = ({
    revision,
    className,
    type = "variant",
    deploymentName,
    ...props
}) => {
    return (
        <Tag
            color="default"
            bordered={false}
            className={clsx("bg-[rgba(5,23,41,0.06)] flex items-center gap-1", className)}
            {...props}
        >
            {type == "deployment" ? (
                <>
                    <div className="w-1.5 h-1.5 bg-[#070f03] rounded-full" />
                    {deploymentName} {" - "}
                </>
            ) : (
                <div className="w-1.5 h-1.5 bg-[#389E0D] rounded-full" />
            )}
            {`v${revision}`}
        </Tag>
    )
}

export default Version
