import {Skeleton, Typography} from "antd"

import VariantDetailsWithStatus from "../../VariantDetailsWithStatus"
import {DeploymentRevisionWithVariant} from "../atoms"

interface VariantDetailsRendererProps {
    record: DeploymentRevisionWithVariant
    isLoading?: boolean
    showStable?: boolean
}

const VariantDetailsRenderer = ({
    record,
    isLoading = false,
    ...props
}: VariantDetailsRendererProps) => {
    return record.variant ? (
        <VariantDetailsWithStatus
            variantName={record.variant?.variantName || record.variant?.name || ""}
            revision={record.revision}
            variant={record.variant}
            {...props}
        />
    ) : isLoading ? (
        <Skeleton.Button active size="small" style={{width: 200}} />
    ) : (
        <Typography.Text type="danger">This variant could not be found</Typography.Text>
    )
}

export default VariantDetailsRenderer
