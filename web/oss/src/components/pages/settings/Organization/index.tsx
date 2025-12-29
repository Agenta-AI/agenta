import {type FC, useState} from "react"

import {Card, Descriptions, Input, Space, Tag, Typography} from "antd"

import {useOrgData} from "@/oss/state/org"

const {Title, Text} = Typography

const Organization: FC = () => {
    const {selectedOrg, loading} = useOrgData()
    const [editingSlug, setEditingSlug] = useState(false)
    const [editingName, setEditingName] = useState(false)
    const [editingDescription, setEditingDescription] = useState(false)

    const [slugValue, setSlugValue] = useState("")
    const [nameValue, setNameValue] = useState("")
    const [descriptionValue, setDescriptionValue] = useState("")

    if (loading) {
        return <div>Loading...</div>
    }

    if (!selectedOrg) {
        return <div>No organization selected</div>
    }

    const isPersonal = selectedOrg.flags?.is_personal ?? true
    const isDemo = selectedOrg.flags?.is_demo ?? false

    return (
        <Space direction="vertical" size="large" style={{width: "100%"}}>
            <Card>
                <Descriptions column={1} bordered>
                    <Descriptions.Item label="Slug">
                        {selectedOrg.slug ? (
                            <Text>{selectedOrg.slug}</Text>
                        ) : editingSlug ? (
                            <Input
                                value={slugValue}
                                onChange={(e) => setSlugValue(e.target.value)}
                                onBlur={() => {
                                    // TODO: Save slug
                                    setEditingSlug(false)
                                }}
                                onPressEnter={() => {
                                    // TODO: Save slug
                                    setEditingSlug(false)
                                }}
                                autoFocus
                            />
                        ) : (
                            <Text
                                editable={{
                                    onStart: () => {
                                        setSlugValue("")
                                        setEditingSlug(true)
                                    },
                                }}
                                type="secondary"
                            >
                                Not set
                            </Text>
                        )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Name">
                        <Text
                            editable={{
                                onChange: (value) => {
                                    // TODO: Save name
                                    setNameValue(value)
                                },
                            }}
                        >
                            {selectedOrg.name}
                        </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Description">
                        <Text
                            editable={{
                                onChange: (value) => {
                                    // TODO: Save description
                                    setDescriptionValue(value)
                                },
                            }}
                        >
                            {selectedOrg.description || "No description"}
                        </Text>
                    </Descriptions.Item>
                </Descriptions>
            </Card>

            <Card>
                <Title level={4}>Authentication & Access Control</Title>
                <Descriptions column={1} bordered>
                    {selectedOrg.flags?.allow_email !== undefined && (
                        <Descriptions.Item label="Allow email authentication">
                            <Tag color={selectedOrg.flags.allow_email ? "green" : "default"}>
                                {String(selectedOrg.flags.allow_email)}
                            </Tag>
                        </Descriptions.Item>
                    )}
                    {selectedOrg.flags?.allow_social !== undefined && (
                        <Descriptions.Item label="Allow social authentication">
                            <Tag color={selectedOrg.flags.allow_social ? "green" : "default"}>
                                {String(selectedOrg.flags.allow_social)}
                            </Tag>
                        </Descriptions.Item>
                    )}
                    {selectedOrg.flags?.allow_sso !== undefined && (
                        <Descriptions.Item label="Allow SSO (OIDC) authentication">
                            <Tag color={selectedOrg.flags.allow_sso ? "green" : "default"}>
                                {String(selectedOrg.flags.allow_sso)}
                            </Tag>
                        </Descriptions.Item>
                    )}
                    {selectedOrg.flags?.invitations_only !== undefined && (
                        <Descriptions.Item label="Allow auto-join for verified domains">
                            <Tag color={selectedOrg.flags.invitations_only ? "default" : "green"}>
                                {String(!selectedOrg.flags.invitations_only)}
                            </Tag>
                        </Descriptions.Item>
                    )}
                    {selectedOrg.flags?.domains_only !== undefined && (
                        <Descriptions.Item label="Allow access to verified domains only">
                            <Tag color={selectedOrg.flags.domains_only ? "green" : "default"}>
                                {String(selectedOrg.flags.domains_only)}
                            </Tag>
                        </Descriptions.Item>
                    )}
                    {selectedOrg.flags?.allow_root !== undefined && (
                        <Descriptions.Item label="Allow organization owner to bypass controls">
                            <Tag color={selectedOrg.flags.allow_root ? "green" : "default"}>
                                {String(selectedOrg.flags.allow_root)}
                            </Tag>
                        </Descriptions.Item>
                    )}
                </Descriptions>
            </Card>

            <Card>
                <Title level={4}>Verified Domains</Title>
                <Text type="secondary">
                    Configure verified email domains for auto-join and access control
                </Text>
                {/* TODO: Add verified domains configuration */}
            </Card>

            <Card>
                <Title level={4}>SSO / OIDC Configuration</Title>
                <Text type="secondary">
                    Configure Single Sign-On (SSO) using OpenID Connect (OIDC)
                </Text>
                {/* TODO: Add SSO/OIDC configuration */}
            </Card>
        </Space>
    )
}

export default Organization
