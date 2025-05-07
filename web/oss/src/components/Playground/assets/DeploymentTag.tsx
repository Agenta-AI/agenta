import {formatVariantIdWithHash} from "@/oss/lib/helpers/utils"
import {Tag, type TagProps} from "antd"
import clsx from "clsx"

interface Props extends TagProps {
    revision?: number | string
    className?: string
    deploymentName?: string
    deployedVariantId?: string
}

const DeploymentTag: React.FC<Props> = ({
    revision,
    className,
    deploymentName,
    deployedVariantId,
    ...props
}) => {
    return (
        <Tag
            color="default"
            bordered={false}
            className={clsx("bg-[rgba(5,23,41,0.06)] flex items-center gap-1", className)}
            {...props}
        >
            <div className="w-1.5 h-1.5 bg-[#070f03] rounded-full" />
            {deploymentName} {" - "}
            {revision && `v${revision}`}
            {deployedVariantId && formatVariantIdWithHash(deployedVariantId)}
        </Tag>
    )
}

export default DeploymentTag
