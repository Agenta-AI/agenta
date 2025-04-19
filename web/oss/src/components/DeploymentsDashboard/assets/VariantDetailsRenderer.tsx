import {Typography} from "antd"

import {DeploymentRevisionWithVariant} from ".."
import VariantDetailsWithStatus from "../../VariantDetailsWithStatus"

const VariantDetailsRenderer = ({record}: {record: DeploymentRevisionWithVariant}) => {
    return record.variant ? (
        <VariantDetailsWithStatus
            variantName={record.variant?.variantName || record.variant?.name || ""}
            revision={record.revision}
            variant={record.variant}
        />
    ) : (
        <Typography.Text type="danger">This variant could not be found</Typography.Text>
    )
}

export default VariantDetailsRenderer
