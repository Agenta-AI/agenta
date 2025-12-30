import {type FC, useState, useCallback} from "react"

import {Card, Descriptions, Input, Modal, Radio, Space, Typography, message} from "antd"
import {useQueryClient} from "@tanstack/react-query"

import {useOrgData} from "@/oss/state/org"
import {updateOrganization} from "@/oss/services/organization/api"

const {Title, Text} = Typography

const Organization: FC = () => {
    const {selectedOrg, loading, refetch} = useOrgData()
    const queryClient = useQueryClient()
    const [editingSlug, setEditingSlug] = useState(false)
    const [slugValue, setSlugValue] = useState("")
    const [updating, setUpdating] = useState(false)

    const handleUpdateOrganization = useCallback(
        async (payload: {slug?: string; name?: string; description?: string; flags?: any}) => {
            if (!selectedOrg?.id) return

            setUpdating(true)
            try {
                await updateOrganization(selectedOrg.id, payload)
                message.success("Organization updated successfully")
                // Invalidate and refetch organization data
                await queryClient.invalidateQueries({queryKey: ["organizations"]})
                await refetch()
            } catch (error: any) {
                message.error(error?.response?.data?.detail || "Failed to update organization")
                console.error("Failed to update organization:", error)
            } finally {
                setUpdating(false)
            }
        },
        [selectedOrg?.id, queryClient, refetch],
    )

    const handleFlagChange = useCallback(
        (flagName: string, value: boolean) => {
            if (!selectedOrg) return

            // Check if this change would disable all auth methods
            const wouldDisableAllAuth = () => {
                const currentFlags = selectedOrg.flags

                const allowEmail = flagName === "allow_email" ? value : currentFlags.allow_email
                const allowSocial = flagName === "allow_social" ? value : currentFlags.allow_social
                const allowSso = flagName === "allow_sso" ? value : currentFlags.allow_sso

                return !allowEmail && !allowSocial && !allowSso
            }

            // If disabling all auth, show confirmation
            if (wouldDisableAllAuth() && !value) {
                Modal.confirm({
                    title: "Disable all authentication methods?",

                    content: (
                        <div>
                            <p>
                                You are about to disable all authentication methods, for this organization.
                            </p>
                            <p>
                                <strong>To prevent lockout, the "Allow organization owner to bypass controls" flag will be enabled.</strong>
                            </p>
                            <p>Do you want to continue?</p>
                        </div>
                    ),
                    width: 420,
                    okText: "Confirm",
                    okType: "danger",
                    cancelText: "Cancel",
                    onOk: () => {
                        handleUpdateOrganization({
                            flags: {
                                [flagName]: value,
                            },
                        })
                    },
                })
            } else {
                handleUpdateOrganization({
                    flags: {
                        [flagName]: value,
                    },
                })
            }
        },
        [handleUpdateOrganization, selectedOrg],
    )

    const handleSlugSave = useCallback(() => {
        if (slugValue.trim()) {
            handleUpdateOrganization({slug: slugValue.trim()})
        }
        setEditingSlug(false)
    }, [slugValue, handleUpdateOrganization])

    if (loading) {
        return <div>Loading...</div>
    }

    if (!selectedOrg) {
        return <div>No organization selected</div>
    }

    const isPersonal = selectedOrg.flags.is_personal
    const isDemo = selectedOrg.flags.is_demo

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
                                onBlur={handleSlugSave}
                                onPressEnter={handleSlugSave}
                                disabled={updating}
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
                                    handleUpdateOrganization({name: value})
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
                                    handleUpdateOrganization({description: value})
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
                    <Descriptions.Item label="Allow email authentication">
                        <Radio.Group
                            value={selectedOrg.flags.allow_email ? "yes" : "no"}
                            size="small"
                            onChange={(e) => handleFlagChange("allow_email", e.target.value === "yes")}
                            disabled={updating}
                        >
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow social authentication">
                        <Radio.Group
                            value={selectedOrg.flags.allow_social ? "yes" : "no"}
                            size="small"
                            onChange={(e) => handleFlagChange("allow_social", e.target.value === "yes")}
                            disabled={updating}
                        >
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow SSO (OIDC) authentication">
                        <Radio.Group
                            value={selectedOrg.flags.allow_sso ? "yes" : "no"}
                            size="small"
                            onChange={(e) => handleFlagChange("allow_sso", e.target.value === "yes")}
                            disabled={updating}
                        >
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow auto-join for verified domains">
                        <Radio.Group
                            value={selectedOrg.flags.auto_join ? "yes" : "no"}
                            size="small"
                            onChange={(e) =>
                                handleFlagChange("auto_join", e.target.value === "yes")
                            }
                            disabled={updating}
                        >
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow access to verified domains only">
                        <Radio.Group
                            value={selectedOrg.flags.domains_only ? "yes" : "no"}
                            size="small"
                            onChange={(e) => handleFlagChange("domains_only", e.target.value === "yes")}
                            disabled={updating}
                        >
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                    <Descriptions.Item label="Allow organization owner to bypass controls">
                        <Radio.Group
                            value={selectedOrg.flags.allow_root ? "yes" : "no"}
                            size="small"
                            onChange={(e) => handleFlagChange("allow_root", e.target.value === "yes")}
                            disabled={updating}
                        >
                            <Radio.Button value="yes">Yes</Radio.Button>
                            <Radio.Button value="no">No</Radio.Button>
                        </Radio.Group>
                    </Descriptions.Item>
                </Descriptions>
            </Card>

            <Card>
                <Title level={4}>Verified Domains</Title>
                <Space vertical size="middle" style={{width: "100%"}}>
                    <Text type="secondary">
                        Configure verified email domains for auto-join and access control. Users with
                        email addresses from these domains can automatically join the organization.
                    </Text>
                    <Text type="secondary" style={{fontSize: "12px"}}>
                        Note: Domain verification endpoints are ready. UI for adding, verifying, and
                        removing domains will be implemented when the backend routes are available.
                    </Text>
                </Space>
            </Card>

            <Card>
                <Title level={4}>SSO / OIDC Configuration</Title>
                <Space vertical size="middle" style={{width: "100%"}}>
                    <Text type="secondary">
                        Configure Single Sign-On (SSO) using OpenID Connect (OIDC) protocol. This
                        allows users to authenticate using your organization's identity provider.
                    </Text>
                    <Text type="secondary" style={{fontSize: "12px"}}>
                        Note: SSO provider endpoints are ready. UI for configuring OIDC providers
                        (issuer URL, client ID, client secret, scopes) will be implemented when the
                        backend routes are available.
                    </Text>
                </Space>
            </Card>
        </Space>
    )
}

export default Organization
