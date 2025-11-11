import {Typography} from "antd"

import type {TimeRange} from "@/oss/components/TimeFilter"

interface ObservabilityOverviewProps {
    timeRange?: TimeRange
}

const ObservabilityOverview: React.FC<ObservabilityOverviewProps> = ({timeRange = "30_days"}) => {
    return (
        <div style={{padding: "24px", textAlign: "center", background: "#f5f5f5", borderRadius: 8}}>
            <Typography.Title level={4} type="secondary">
                Observability Dashboard
            </Typography.Title>
            <Typography.Text type="secondary">
                Observability metrics and analytics will be displayed here.
                <br />
                Time range: {timeRange.replace("_", " ")}
            </Typography.Text>
        </div>
    )
}

export default ObservabilityOverview
