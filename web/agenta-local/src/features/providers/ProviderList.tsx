import {CheckCircleFilled, DeleteOutlined, SafetyCertificateOutlined} from "@ant-design/icons"
import {Button, Empty, List, Popconfirm, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useState} from "react"

import {providersQueryAtom, removeProvider} from "@/lib/state/providers"

export const ProviderList = () => {
    const providers = useAtomValue(providersQueryAtom)
    const [deleting, setDeleting] = useState<string | null>(null)
    const configured = providers.data?.filter((provider) => provider.configured) ?? []

    if (providers.isPending)
        return <div className="skeleton-block" aria-label="Loading providers" />
    if (providers.isError)
        return <Typography.Text type="danger">Could not load provider settings.</Typography.Text>
    if (!configured.length)
        return (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No providers connected yet" />
        )

    return (
        <List
            className="provider-list"
            dataSource={configured}
            renderItem={(provider) => (
                <List.Item
                    actions={[
                        <Popconfirm
                            key="remove"
                            title="Remove this provider?"
                            description="New turns using it will stop working until it is reconnected."
                            onConfirm={async () => {
                                setDeleting(provider.provider)
                                try {
                                    await removeProvider(provider.provider)
                                } finally {
                                    setDeleting(null)
                                }
                            }}
                        >
                            <Button
                                danger
                                type="text"
                                loading={deleting === provider.provider}
                                icon={<DeleteOutlined />}
                                aria-label={`Remove ${provider.provider}`}
                            />
                        </Popconfirm>,
                    ]}
                >
                    <List.Item.Meta
                        avatar={
                            <div className="provider-avatar">
                                <SafetyCertificateOutlined />
                            </div>
                        }
                        title={<span className="provider-name">{provider.provider}</span>}
                        description={`Key ending in ${provider.key_suffix}`}
                    />
                    <Tag color="success" icon={<CheckCircleFilled />}>
                        Connected
                    </Tag>
                </List.Item>
            )}
        />
    )
}
