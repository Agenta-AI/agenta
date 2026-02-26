import {Tag} from "antd"

import type {ConnectionItem} from "@/oss/services/tools/api/types"

export default function ConnectionStatusBadge({connection}: {connection: ConnectionItem}) {
    const isActive = connection.flags?.is_active ?? false
    const isValid = connection.flags?.is_valid ?? false

    if (isValid && isActive) {
        return <Tag color="success">Connected</Tag>
    }
    if (!isActive) {
        return <Tag color="default">Inactive</Tag>
    }
    return <Tag color="processing">Pending</Tag>
}
