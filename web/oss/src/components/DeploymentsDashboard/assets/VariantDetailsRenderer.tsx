import {Typography} from "antd"

import VariantDetailsWithStatus from "../../VariantDetailsWithStatus"
import {DeploymentRevisionWithVariant} from "../atoms"

const VariantDetailsRenderer = ({record, ...props}: {record: DeploymentRevisionWithVariant}) => {
    return record.variant ? (
        <VariantDetailsWithStatus
            variantName={record.variant?.variantName || record.variant?.name || ""}
            revision={record.revision}
            variant={record.variant}
            {...props}
        />
    ) : (
        <Typography.Text type="danger">This variant could not be found</Typography.Text>
    )
}

export default VariantDetailsRenderer
