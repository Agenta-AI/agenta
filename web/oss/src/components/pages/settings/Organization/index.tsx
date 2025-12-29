import {type FC, useState} from "react"

import {Card, Descriptions, Input, Radio, Space, Tag, Typography} from "antd"

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
                <Title level={4}>Access Control</Title>
                <Descriptions column={1} bordered>
                    <Descriptions.Item label="Allow email authentication">
                        <Radio.Group value={selectedOrg.flags?.allow_email ? "yes" : "no"} size="small">
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow social authentication">
                        <Radio.Group value={selectedOrg.flags?.allow_social ? "yes" : "no"} size="small">
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow SSO (OIDC) authentication">
                        <Radio.Group value={selectedOrg.flags?.allow_sso ? "yes" : "no"} size="small">
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow auto-join for verified domains">
                        <Radio.Group value={!(selectedOrg.flags?.invitations_only ?? true) ? "yes" : "no"} size="small">
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow access to verified domains only">
                        <Radio.Group value={selectedOrg.flags?.domains_only ? "yes" : "no"} size="small">
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow organization owner to bypass controls">
                        <Radio.Group value={selectedOrg.flags?.allow_root ? "yes" : "no"} size="small">
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                </Descriptions>
            </Card>

            <Card>
                <Title level={4}>Domain Verification</Title>
                <Text type="secondary">
                    Configure verified email domains for auto-join and access control
                </Text>
                {/* TODO: Add verified domains configuration */}
            </Card>

            <Card>
                <Title level={4}>SSO Configuration</Title>
                <Text type="secondary">
                    Configure Single Sign-On (SSO) using OpenID Connect (OIDC)
                </Text>
                {/* TODO: Add SSO/OIDC configuration */}
            </Card>
        </Space>
    )
}

export default Organization
