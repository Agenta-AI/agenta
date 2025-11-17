import {Typography} from "antd"

const ObservabilityOverview: React.FC = () => {
    return (
        <div style={{padding: "24px", textAlign: "center", background: "#f5f5f5", borderRadius: 8}}>
            <Typography.Title level={4} type="secondary">
                Observability Dashboard
            </Typography.Title>
            <Typography.Text type="secondary">
                Observability metrics and analytics will be displayed here.
            </Typography.Text>
        </div>
    )
}

export default ObservabilityOverview
