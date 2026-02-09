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
    showStable,
}: VariantDetailsRendererProps) => {
    return record.variant ? (
        <VariantDetailsWithStatus
            variantName={record.variant?.variantName || record.variant?.name || ""}
            revision={record.variant?.revision}
            variant={record.variant}
            showStable={showStable}
        />
    ) : isLoading ? (
        <Skeleton.Button active size="small" style={{width: 200}} />
    ) : !record.deployed_app_variant_revision ? (
        <Typography.Text type="secondary">Not deployed in this revision</Typography.Text>
    ) : (
        <Typography.Text type="danger">This variant could not be found</Typography.Text>
    )
}

export default VariantDetailsRenderer
