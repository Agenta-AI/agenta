import {Typography} from "antd"
import React from "react"

const NoTraceAnnotations = () => {
    return (
        <div className="flex items-center justify-center">
            <Typography.Text type="secondary">
                There are no annotations for this trace
            </Typography.Text>
        </div>
    )
}

export default NoTraceAnnotations
