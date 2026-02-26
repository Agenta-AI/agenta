import {Typography} from "antd"

export default function AgentaToolsPlaceholder() {
    return (
        <section className="flex flex-col gap-2">
            <Typography.Title level={5} className="!mb-0">
                Agenta Tools
            </Typography.Title>
            <Typography.Text type="secondary">
                Coming soon — built-in Agenta tool integrations.
            </Typography.Text>
        </section>
    )
}
