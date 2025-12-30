import {type FC, useState, useCallback} from "react"

import {
    Card,
    Descriptions,
    Input,
    Modal,
    Radio,
    Space,
    Typography,
    message,
    Table,
    Button,
    Form,
    Tag,
    Popconfirm,
    Alert,
} from "antd"
import {useQueryClient, useQuery, useMutation} from "@tanstack/react-query"
import {PlusOutlined, CheckCircleOutlined, ClockCircleOutlined, DeleteOutlined, InfoCircleOutlined, ReloadOutlined} from "@ant-design/icons"

import {useOrgData} from "@/oss/state/org"
import {
    updateOrganization,
    fetchOrganizationDomains,
    createOrganizationDomain,
    verifyOrganizationDomain,
    refreshOrganizationDomainToken,
    deleteOrganizationDomain,
    type OrganizationDomain,
    fetchOrganizationProviders,
    createOrganizationProvider,
    updateOrganizationProvider,
    testOrganizationProvider,
    deleteOrganizationProvider,
    type OrganizationProvider,
} from "@/oss/services/organization/api"
import TooltipWithCopyAction from "@/oss/components/EnhancedUIs/Tooltip"

const {Title, Text} = Typography

const Organization: FC = () => {
    const {selectedOrg, loading, refetch} = useOrgData()
    const queryClient = useQueryClient()
    const [editingSlug, setEditingSlug] = useState(false)
    const [slugValue, setSlugValue] = useState("")
    const [updating, setUpdating] = useState(false)
    const [domainModalVisible, setDomainModalVisible] = useState(false)
    const [domainForm] = Form.useForm()
    const [providerModalVisible, setProviderModalVisible] = useState(false)
    const [providerForm] = Form.useForm()
    const [editingProvider, setEditingProvider] = useState<string | null>(null)

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

    // Domain Verification queries and mutations
    const {data: domains = [], refetch: refetchDomains} = useQuery({
        queryKey: ["organization-domains", selectedOrg?.id],
        queryFn: fetchOrganizationDomains,
        enabled: !!selectedOrg?.id,
    })

    const createDomainMutation = useMutation({
        mutationFn: createOrganizationDomain,
        onSuccess: () => {
            message.success("Domain added successfully. Token is available in the table.")
            refetchDomains()
            setDomainModalVisible(false)
            domainForm.resetFields()
        },
        onError: (error: any) => {
            message.error(error?.response?.data?.detail || "Failed to add domain")
        },
        useErrorBoundary: false,
        throwOnError: false,
    })

    const verifyDomainMutation = useMutation({
        mutationFn: verifyOrganizationDomain,
        onSuccess: () => {
            message.success("Domain verified successfully")
            refetchDomains()
        },
        onError: (error: any) => {
            const errorMessage = error?.response?.data?.detail || "Failed to verify domain"
            message.error(errorMessage)
            console.error("Domain verification error:", error)
        },
        useErrorBoundary: false,
        throwOnError: false,
    })

    const refreshDomainTokenMutation = useMutation({
        mutationFn: refreshOrganizationDomainToken,
        onSuccess: () => {
            message.success("Token refreshed successfully")
            refetchDomains()
        },
        onError: (error: any) => {
            message.error(error?.response?.data?.detail || "Failed to refresh token")
        },
        useErrorBoundary: false,
        throwOnError: false,
    })

    const deleteDomainMutation = useMutation({
        mutationFn: deleteOrganizationDomain,
        onSuccess: () => {
            message.success("Domain deleted successfully")
            refetchDomains()
        },
        onError: (error: any) => {
            message.error(error?.response?.data?.detail || "Failed to delete domain")
        },
        useErrorBoundary: false,
        throwOnError: false,
    })

    const handleAddDomain = useCallback(() => {
        domainForm.validateFields().then((values) => {
            createDomainMutation.mutate({
                domain: values.domain,
                name: values.name,
                description: values.description,
            })
        })
    }, [domainForm, createDomainMutation])

    const domainColumns = [
        {
            title: "Domain",
            dataIndex: "slug",
            key: "slug",
        },
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
        },
        {
            title: "Status",
            dataIndex: ["flags", "is_verified"],
            key: "is_verified",
            render: (_: any, record: OrganizationDomain) => {
                const isVerified = record.flags?.is_verified || false
                return isVerified ? (
                    <Tag icon={<CheckCircleOutlined />} color="success">
                        Verified
                    </Tag>
                ) : (
                    <Tag icon={<ClockCircleOutlined />} color="warning">
                        Pending
                    </Tag>
                )
            },
        },
        {
            title: "Token",
            dataIndex: "token",
            key: "token",
            render: (token: string | null, record: OrganizationDomain) => {
                if (record.flags?.is_verified) {
                    return <Text type="secondary">-</Text>
                }
                if (!token) {
                    return <Text type="secondary" italic>Hidden</Text>
                }
                return (
                    <TooltipWithCopyAction
                        copyText={token}
                        title="Copy verification token"
                    >
                        <Tag className="font-mono bg-[#0517290F] text-xs" bordered={false}>
                            {token}
                        </Tag>
                    </TooltipWithCopyAction>
                )
            },
        },
        {
            title: "Expiration",
            key: "expires_at",
            render: (_: any, record: OrganizationDomain) => {
                if (record.flags?.is_verified) {
                    return <Text type="secondary">-</Text>
                }
                // Calculate expiration: created_at + 48 hours
                const createdAt = new Date(record.created_at)
                const expiresAt = new Date(createdAt.getTime() + 48 * 60 * 60 * 1000)
                const now = new Date()
                const isExpired = now > expiresAt

                return (
                    <Text type={isExpired ? "danger" : "secondary"}>
                        {expiresAt.toLocaleString()}
                        {isExpired && " (Expired)"}
                    </Text>
                )
            },
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: OrganizationDomain) => (
                <Space>
                    {!record.flags?.is_verified && (
                        <Button
                            type="primary"
                            size="small"
                            onClick={() => {
                                verifyDomainMutation.mutate(record.id, {
                                    onError: (error: any) => {
                                        // Error already handled in mutation config
                                        console.error("Verification failed:", error)
                                    }
                                })
                            }}
                            loading={verifyDomainMutation.isPending}
                        >
                            Verify
                        </Button>
                    )}
                    <Button
                        icon={<ReloadOutlined />}
                        size="small"
                        onClick={() => refreshDomainTokenMutation.mutate(record.id)}
                        loading={refreshDomainTokenMutation.isPending}
                        title="Refresh token"
                    />
                    <Popconfirm
                        title="Delete domain"
                        description="Are you sure you want to delete this domain?"
                        onConfirm={() => deleteDomainMutation.mutate(record.id)}
                        okText="Delete"
                        okType="danger"
                        cancelText="Cancel"
                    >
                        <Button
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            loading={deleteDomainMutation.isPending}
                        />
                    </Popconfirm>
                </Space>
            ),
        },
    ]

    // SSO Provider queries and mutations
    const {data: providers = [], refetch: refetchProviders} = useQuery({
        queryKey: ["organization-providers", selectedOrg?.id],
        queryFn: fetchOrganizationProviders,
        enabled: !!selectedOrg?.id,
    })

    const createProviderMutation = useMutation({
        mutationFn: createOrganizationProvider,
        onSuccess: () => {
            message.success("SSO provider added successfully")
            refetchProviders()
            setProviderModalVisible(false)
            setEditingProvider(null)
            providerForm.resetFields()
        },
        onError: (error: any) => {
            message.error(error?.response?.data?.detail || "Failed to add SSO provider")
        },
        useErrorBoundary: false,
        throwOnError: false,
    })

    const updateProviderMutation = useMutation({
        mutationFn: ({providerId, payload}: {providerId: string; payload: any}) =>
            updateOrganizationProvider(providerId, payload),
        onSuccess: () => {
            message.success("SSO provider updated successfully")
            refetchProviders()
            setProviderModalVisible(false)
            setEditingProvider(null)
            providerForm.resetFields()
        },
        onError: (error: any) => {
            message.error(error?.response?.data?.detail || "Failed to update SSO provider")
        },
        useErrorBoundary: false,
        throwOnError: false,
    })

    const testProviderMutation = useMutation({
        mutationFn: testOrganizationProvider,
        onSuccess: () => {
            message.success("SSO provider connection test successful")
            refetchProviders()
        },
        onError: (error: any) => {
            message.error(error?.response?.data?.detail || "SSO provider connection test failed")
        },
        useErrorBoundary: false,
        throwOnError: false,
    })

    const deleteProviderMutation = useMutation({
        mutationFn: deleteOrganizationProvider,
        onSuccess: () => {
            message.success("SSO provider deleted successfully")
            refetchProviders()
        },
        onError: (error: any) => {
            message.error(error?.response?.data?.detail || "Failed to delete SSO provider")
        },
        useErrorBoundary: false,
        throwOnError: false,
    })

    const handleAddOrUpdateProvider = useCallback(() => {
        providerForm.validateFields().then((values) => {
            const payload = {
                slug: values.slug,
                provider_type: "oidc" as const,
                config: {
                    issuer_url: values.issuer_url,
                    client_id: values.client_id,
                    client_secret: values.client_secret,
                    scopes: values.scopes?.split(",").map((s: string) => s.trim()) || ["openid", "profile", "email"],
                },
            }

            if (editingProvider) {
                updateProviderMutation.mutate({
                    providerId: editingProvider,
                    payload,
                })
            } else {
                createProviderMutation.mutate(payload)
            }
        })
    }, [providerForm, editingProvider, createProviderMutation, updateProviderMutation])

    const handleEditProvider = useCallback(
        (provider: OrganizationProvider) => {
            setEditingProvider(provider.id)
            providerForm.setFieldsValue({
                slug: provider.slug,
                issuer_url: provider.config.issuer_url,
                client_id: provider.config.client_id,
                client_secret: provider.config.client_secret,
                scopes: provider.config.scopes?.join(", "),
            })
            setProviderModalVisible(true)
        },
        [providerForm],
    )

    const providerColumns = [
        {
            title: "Name",
            dataIndex: "slug",
            key: "slug",
        },
        {
            title: "Type",
            dataIndex: "provider_type",
            key: "provider_type",
            render: (type: string) => <Tag color="blue">{type.toUpperCase()}</Tag>,
        },
        {
            title: "Issuer URL",
            dataIndex: ["config", "issuer_url"],
            key: "issuer_url",
            render: (url: string) => (
                <Text ellipsis style={{maxWidth: 300}}>
                    {url}
                </Text>
            ),
        },
        {
            title: "Status",
            key: "status",
            render: (_: any, record: OrganizationProvider) => {
                const isEnabled = record.flags?.is_enabled !== false
                const isValid = record.flags?.is_valid !== false

                if (!isEnabled) {
                    return <Tag color="default">Disabled</Tag>
                }
                if (isValid) {
                    return (
                        <Tag icon={<CheckCircleOutlined />} color="success">
                            Active
                        </Tag>
                    )
                }
                return (
                    <Tag icon={<ClockCircleOutlined />} color="warning">
                        Not Tested
                    </Tag>
                )
            },
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: OrganizationProvider) => (
                <Space>
                    <Button
                        size="small"
                        onClick={() => testProviderMutation.mutate(record.id)}
                        loading={testProviderMutation.isPending}
                    >
                        Test
                    </Button>
                    <Button size="small" onClick={() => handleEditProvider(record)}>
                        Edit
                    </Button>
                    <Popconfirm
                        title="Delete SSO provider"
                        description="Are you sure you want to delete this SSO provider?"
                        onConfirm={() => deleteProviderMutation.mutate(record.id)}
                        okText="Delete"
                        okType="danger"
                        cancelText="Cancel"
                    >
                        <Button
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            loading={deleteProviderMutation.isPending}
                        />
                    </Popconfirm>
                </Space>
            ),
        },
    ]

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
                <Title level={4}>Details</Title>
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
                <Title level={4}>Access Control</Title>
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
                <Space direction="vertical" size="middle" style={{width: "100%"}}>
                    <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                        <div>
                            <Title level={4} style={{margin: 0}}>
                                Verified Domains
                            </Title>
                            <Text type="secondary">
                                Configure verified domains for organization auto-join and SSO enforcement.
                            </Text>
                        </div>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => setDomainModalVisible(true)}
                        >
                            Add Domain
                        </Button>
                    </div>

                    <Table
                        columns={domainColumns}
                        dataSource={domains}
                        rowKey="id"
                        pagination={false}
                        size="small"
                        expandable={{
                            expandedRowRender: (record: OrganizationDomain) => {
                                // Only show DNS instructions for unverified domains with a token
                                if (record.flags?.is_verified || !record.token) {
                                    return null
                                }

                                const txtRecordName = `_agenta-verification.${record.slug}`
                                const txtRecordValue = `agenta-verification=${record.token}`

                                return (
                                    <Alert
                                        message={<span style={{fontSize: "15px", fontWeight: 500}}>DNS Verification Instructions</span>}
                                        description={
                                            <Space direction="vertical" size="middle" style={{width: "100%"}}>
                                                <Text style={{fontSize: "14px"}}>
                                                    To verify ownership of <Text strong>{record.slug}</Text>, add the following DNS TXT record:
                                                </Text>
                                                <Descriptions bordered size="small" column={1}>
                                                    <Descriptions.Item label={<span style={{fontSize: "14px"}}>Record Type</span>}>
                                                        <Text code style={{fontSize: "14px"}}>TXT</Text>
                                                    </Descriptions.Item>
                                                    <Descriptions.Item label={<span style={{fontSize: "14px"}}>Host/Name</span>}>
                                                        <TooltipWithCopyAction copyText={txtRecordName} title="Copy host name">
                                                            <Text code style={{fontSize: "14px"}}>{txtRecordName}</Text>
                                                        </TooltipWithCopyAction>
                                                    </Descriptions.Item>
                                                    <Descriptions.Item label={<span style={{fontSize: "14px"}}>Value</span>}>
                                                        <TooltipWithCopyAction copyText={txtRecordValue} title="Copy value">
                                                            <Text code className="break-all" style={{fontSize: "14px"}}>{txtRecordValue}</Text>
                                                        </TooltipWithCopyAction>
                                                    </Descriptions.Item>
                                                </Descriptions>
                                                <Text type="secondary" style={{fontSize: "13px"}}>
                                                    After adding the DNS record, wait 5-30 minutes for DNS propagation, then click the "Verify" button.
                                                    The verification token expires after 48 hours.
                                                </Text>
                                            </Space>
                                        }
                                        type="info"
                                        icon={<InfoCircleOutlined />}
                                        showIcon
                                    />
                                )
                            },
                            rowExpandable: (record: OrganizationDomain) => !record.flags?.is_verified && !!record.token,
                            expandIcon: ({expanded, onExpand, record}) => {
                                // Only show expand icon for unverified domains with tokens
                                if (record.flags?.is_verified || !record.token) {
                                    return null
                                }
                                return (
                                    <InfoCircleOutlined
                                        style={{
                                            fontSize: "16px",
                                            color: expanded ? "#1890ff" : "#8c8c8c",
                                            cursor: "pointer",
                                        }}
                                        onClick={(e) => onExpand(record, e)}
                                    />
                                )
                            },
                        }}
                    />
                </Space>

                <Modal
                    title="Add Domain"
                    open={domainModalVisible}
                    onOk={handleAddDomain}
                    onCancel={() => {
                        setDomainModalVisible(false)
                        domainForm.resetFields()
                    }}
                    confirmLoading={createDomainMutation.isPending}
                    okText="Add"
                >
                    <Form form={domainForm} layout="vertical" style={{marginTop: 16}}>
                        <Form.Item
                            name="domain"
                            label="Domain"
                            rules={[
                                {required: true, message: "Please enter a domain"},
                                {
                                    pattern: /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/,
                                    message: "Please enter a valid domain (e.g., example.com or app.example.com)",
                                },
                            ]}
                        >
                            <Input placeholder="example.com or app.example.com" />
                        </Form.Item>
                        <Form.Item
                            name="name"
                            label="Name"
                            rules={[{required: true, message: "Please enter a name"}]}
                        >
                            <Input placeholder="Company Domain" />
                        </Form.Item>
                        <Form.Item name="description" label="Description">
                            <Input.TextArea placeholder="Optional description" rows={3} />
                        </Form.Item>
                        <Text type="secondary" style={{fontSize: "12px"}}>
                            After adding the domain, you'll need to add a DNS TXT record with the
                            verification token to prove ownership.
                        </Text>
                    </Form>
                </Modal>
            </Card>

            <Card>
                <Space direction="vertical" size="middle" style={{width: "100%"}}>
                    <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                        <div>
                            <Title level={4} style={{margin: 0}}>
                                SSO Profiles
                            </Title>
                            <Text type="secondary">
                                Configure Single Sign-On (SSO) via OpenID Connect (OIDC).
                            </Text>
                        </div>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => setProviderModalVisible(true)}
                        >
                            Add Provider
                        </Button>
                    </div>

                    <Table
                        columns={providerColumns}
                        dataSource={providers}
                        rowKey="id"
                        pagination={false}
                        size="small"
                    />
                </Space>

                <Modal
                    title={editingProvider ? "Edit SSO Provider" : "Add SSO Provider"}
                    open={providerModalVisible}
                    onOk={handleAddOrUpdateProvider}
                    onCancel={() => {
                        setProviderModalVisible(false)
                        setEditingProvider(null)
                        providerForm.resetFields()
                    }}
                    confirmLoading={createProviderMutation.isPending || updateProviderMutation.isPending}
                    okText={editingProvider ? "Update" : "Add"}
                    width={600}
                >
                    <Form form={providerForm} layout="vertical" style={{marginTop: 16}}>
                        <Form.Item
                            name="slug"
                            label="Provider Name"
                            rules={[{required: true, message: "Please enter a provider name"}]}
                        >
                            <Input placeholder="my-idp" />
                        </Form.Item>
                        <Form.Item
                            name="issuer_url"
                            label="Issuer URL"
                            rules={[
                                {required: true, message: "Please enter the issuer URL"},
                                {type: "url", message: "Please enter a valid URL"},
                            ]}
                        >
                            <Input placeholder="https://accounts.google.com" />
                        </Form.Item>
                        <Form.Item
                            name="client_id"
                            label="Client ID"
                            rules={[{required: true, message: "Please enter the client ID"}]}
                        >
                            <Input placeholder="Your OAuth 2.0 Client ID" />
                        </Form.Item>
                        <Form.Item
                            name="client_secret"
                            label="Client Secret"
                            rules={[{required: true, message: "Please enter the client secret"}]}
                        >
                            <Input.Password placeholder="Your OAuth 2.0 Client Secret" />
                        </Form.Item>
                        <Form.Item
                            name="scopes"
                            label="Scopes (comma-separated)"
                            initialValue="openid, profile, email"
                        >
                            <Input placeholder="openid, profile, email" />
                        </Form.Item>
                        <Text type="secondary" style={{fontSize: "12px"}}>
                            After adding the provider, use the "Test" button to verify the connection.
                        </Text>
                    </Form>
                </Modal>
            </Card>
        </Space>
    )
}

export default Organization
