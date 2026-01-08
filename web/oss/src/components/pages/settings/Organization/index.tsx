import {type FC, useState, useCallback, useMemo} from "react"

import {
    PlusOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DeleteOutlined,
    EditOutlined,
    InfoCircleOutlined,
    ReloadOutlined,
} from "@ant-design/icons"
import {useQueryClient, useQuery, useMutation} from "@tanstack/react-query"
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
    Tooltip,
} from "antd"

import TooltipWithCopyAction from "@/oss/components/EnhancedUIs/Tooltip"
import {getAgentaWebUrl} from "@/oss/lib/helpers/api"
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
import {useOrgData} from "@/oss/state/org"

const {Title, Text} = Typography

const Organization: FC = () => {
    const {selectedOrg, loading, refetch} = useOrgData()
    const queryClient = useQueryClient()
    const [slugValue, setSlugValue] = useState("")
    const [slugModalVisible, setSlugModalVisible] = useState(false)
    const [updating, setUpdating] = useState(false)
    const [domainModalVisible, setDomainModalVisible] = useState(false)
    const [domainForm] = Form.useForm()
    const [providerModalVisible, setProviderModalVisible] = useState(false)
    const [providerForm] = Form.useForm()
    const [editingProvider, setEditingProvider] = useState<string | null>(null)

    const handleUpdateOrganization = useCallback(
        async (
            payload: {slug?: string; name?: string; description?: string; flags?: any},
            options?: {ignoreAxiosError?: boolean},
        ) => {
            if (!selectedOrg?.id) return

            setUpdating(true)
            try {
                const updated = await updateOrganization(
                    selectedOrg.id,
                    payload,
                    options?.ignoreAxiosError ?? false,
                )
                if (updated) {
                    queryClient.setQueryData(["selectedOrg", selectedOrg.id], updated)
                    queryClient.setQueriesData(["orgs"], (old: any) => {
                        if (!Array.isArray(old)) return old
                        return old.map((org) =>
                            org.id === updated.id ? {...org, ...updated} : org,
                        )
                    })
                }
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

    // Domain Verification queries and mutations
    const {data: domains = [], refetch: refetchDomains} = useQuery({
        queryKey: ["organization-domains", selectedOrg?.id],
        queryFn: fetchOrganizationDomains,
        enabled: !!selectedOrg?.id,
    })
    const hasVerifiedDomain = useMemo(
        () => domains.some((domain) => domain.flags?.is_verified),
        [domains],
    )

    const handleSlugSave = useCallback(() => {
        if (!slugValue.trim()) return
        handleUpdateOrganization({slug: slugValue.trim()}, {ignoreAxiosError: true})
        setSlugModalVisible(false)
    }, [slugValue, handleUpdateOrganization])

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
    })

    const verifyDomainMutation = useMutation({
        mutationFn: verifyOrganizationDomain,
        onSuccess: () => {
            message.success("Domain verified successfully")
            refetchDomains()
        },
        onError: (error: any) => {
            const errorMessage =
                error?.response?.data?.detail || error?.message || "Failed to verify domain"
            message.error(errorMessage)
        },
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
    })

    const handleAddDomain = useCallback(() => {
        domainForm.validateFields().then((values) => {
            createDomainMutation.mutate({
                domain: values.domain,
            })
        })
    }, [domainForm, createDomainMutation])

    const domainColumns = [
        {
            title: "Domain",
            dataIndex: "slug",
            key: "slug",
            ellipsis: true,
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
            title: "Actions",
            key: "actions",
            render: (_: any, record: OrganizationDomain) => (
                <Space>
                    {!record.flags?.is_verified && (
                        <Button
                            type="primary"
                            size="small"
                            onClick={() => verifyDomainMutation.mutate(record.id)}
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

    const sectionTitleStyle = {margin: 0, fontSize: 20, fontWeight: 600}

    const pendingDomainRowKeys = domains
        .filter((domain) => !domain.flags?.is_verified && !!domain.token)
        .map((domain) => domain.id)

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
        if (!selectedOrg?.slug) {
            message.error("Set an organization slug before configuring SSO providers.")
            return
        }
        providerForm.validateFields().then((values) => {
            const payload = {
                slug: values.slug,
                settings: {
                    issuer_url: values.issuer_url,
                    client_id: values.client_id,
                    client_secret: values.client_secret,
                    scopes: values.scopes?.split(",").map((s: string) => s.trim()) || [
                        "openid",
                        "profile",
                        "email",
                    ],
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
    }, [
        providerForm,
        editingProvider,
        createProviderMutation,
        updateProviderMutation,
        selectedOrg?.slug,
    ])

    const handleEditProvider = useCallback(
        (provider: OrganizationProvider) => {
            setEditingProvider(provider.id)
            providerForm.setFieldsValue({
                slug: provider.slug,
                issuer_url: provider.settings.issuer_url,
                client_id: provider.settings.client_id,
                client_secret: provider.settings.client_secret,
                scopes: provider.settings.scopes?.join(", "),
            })
            setProviderModalVisible(true)
        },
        [providerForm],
    )

    const pendingProviderRowKeys = providers
        .filter((provider) => provider.flags?.is_valid === false)
        .map((provider) => provider.id)
    const hasActiveVerifiedProvider = useMemo(
        () =>
            providers.some(
                (provider) =>
                    provider.flags?.is_active && provider.flags?.is_valid,
            ),
        [providers],
    )
    const allAuthMethodsDisabled = useMemo(
        () =>
            !selectedOrg?.flags?.allow_email &&
            !selectedOrg?.flags?.allow_social &&
            !selectedOrg?.flags?.allow_sso,
        [selectedOrg?.flags],
    )
    const handleFlagChange = useCallback(
        (flag: string, value: boolean) => {
            if (!selectedOrg?.id) return

            if (flag === "allow_sso" && value && !hasActiveVerifiedProvider) {
                message.error("Enable at least one active SSO provider before allowing SSO.")
                return
            }

            if (flag === "domains_only" && value && !hasVerifiedDomain) {
                message.error("Verify at least one domain before enforcing verified domains only.")
                return
            }

            if (flag === "auto_join" && value && !hasVerifiedDomain) {
                message.error("Auto-join requires at least one verified domain.")
                return
            }

            // Check if this change would disable all auth methods without owner bypass
            const wouldDisableAllAuthWithoutBypass = () => {
                const currentFlags = selectedOrg.flags

                const allowEmail = flag === "allow_email" ? value : currentFlags.allow_email
                const allowSocial = flag === "allow_social" ? value : currentFlags.allow_social
                const allowSso = flag === "allow_sso" ? value : currentFlags.allow_sso
                const allowRoot = currentFlags.allow_root

                return !allowEmail && !allowSocial && !allowSso && !allowRoot
            }

            // If disabling all auth without owner bypass, show confirmation
            if (wouldDisableAllAuthWithoutBypass() && !value) {
                Modal.confirm({
                    title: "Disable all authentication methods?",
                    content: (
                        <div>
                            <p>
                                You are about to disable all authentication methods for this
                                organization.
                            </p>
                            <p>
                                <strong>
                                    To prevent lockout, the "Owner can bypass controls"
                                    flag will be enabled automatically.
                                </strong>
                            </p>
                            <p>Do you want to continue?</p>
                        </div>
                    ),
                    width: 420,
                    okText: "Confirm",
                    okType: "danger",
                    cancelText: "Cancel",
                    onOk: () => {
                        handleUpdateOrganization(
                            {flags: {[flag]: value}},
                            {ignoreAxiosError: true},
                        )
                    },
                })
            } else {
                handleUpdateOrganization({flags: {[flag]: value}})
            }
        },
        [
            handleUpdateOrganization,
            hasActiveVerifiedProvider,
            hasVerifiedDomain,
            selectedOrg,
        ],
    )

    const providerColumns = [
        {
            title: "Provider",
            dataIndex: "slug",
            key: "slug",
            ellipsis: true,
        },
        {
            title: "Callback URL",
            key: "callback_url",
            render: (_: any, record: OrganizationProvider) => {
                if (!selectedOrg?.slug) {
                    return <Text type="secondary">Set org slug</Text>
                }
                const callbackUrl = `${getAgentaWebUrl()}/auth/callback/sso:${selectedOrg.slug}:${record.slug}`
                return (
                    <Text ellipsis style={{maxWidth: 300}}>
                        {callbackUrl}
                    </Text>
                )
            },
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
                        Pending
                    </Tag>
                )
            },
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: OrganizationProvider) => {
                const isEnabled = record.flags?.is_enabled !== false
                const isValid = record.flags?.is_valid !== false
                return (
                    <Space>
                        {(!isEnabled || !isValid) && (
                            <Button
                                type="primary"
                                size="small"
                                onClick={() => testProviderMutation.mutate(record.id)}
                                loading={testProviderMutation.isPending}
                            >
                                Enable
                            </Button>
                        )}
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            aria-label="Edit provider"
                            onClick={() => handleEditProvider(record)}
                        ></Button>
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
                )
            },
        },
    ]

    if (loading) {
        return <div>Loading...</div>
    }

    if (!selectedOrg) {
        return <div>No organization selected</div>
    }

    const isPersonal = selectedOrg.flags.is_personal

    if (isPersonal) {
        return (
            <section className="flex flex-col items-center justify-center gap-6 py-20 min-h-[400px]">
                <div className="flex flex-col items-center gap-4 text-center max-w-lg px-6 py-8 bg-gray-50 rounded-lg border border-gray-200">
                    <Typography.Title level={4} className="!mb-0">
                        This is your Personal Organization.
                    </Typography.Title>
                    <Typography.Text type="secondary" className="text-base leading-relaxed">
                        To edit access controls, verified domains, and SSO,
                        <br />
                        please create or switch to a collaborative organization.
                    </Typography.Text>
                    <Typography.Text type="secondary" className="text-sm">
                        Click on your organization in the sidebar
                        <br />
                        to create a new organization or switch to an existing one.
                    </Typography.Text>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        size="large"
                        className="mt-2"
                        onClick={() => {
                            window.dispatchEvent(new Event("open-create-organization"))
                        }}
                    >
                        New Organization
                    </Button>
                </div>
            </section>
        )
    }

    return (
        <Space direction="vertical" size="middle" style={{width: "100%"}}>
            <Card>
                <Space direction="vertical" size="small" style={{width: "100%"}}>
                    <div>
                        <Title level={1} style={sectionTitleStyle}>
                            Access Controls
                        </Title>
                    </div>
                    <Descriptions column={1} bordered size="small" className="org-kv-65-35">
                        <Descriptions.Item label="Email authentication">
                            <Radio.Group
                                value={selectedOrg.flags.allow_email ? "yes" : "no"}
                                size="small"
                                onChange={(e) =>
                                    handleFlagChange("allow_email", e.target.value === "yes")
                                }
                                disabled={updating}
                            >
                                <Radio.Button value="yes">Allow</Radio.Button>
                                <Radio.Button value="no">Deny</Radio.Button>
                            </Radio.Group>
                        </Descriptions.Item>
                        <Descriptions.Item label="Social authentication">
                            <Radio.Group
                                value={selectedOrg.flags.allow_social ? "yes" : "no"}
                                size="small"
                                onChange={(e) =>
                                    handleFlagChange("allow_social", e.target.value === "yes")
                                }
                                disabled={updating}
                            >
                                <Radio.Button value="yes">Allow</Radio.Button>
                                <Radio.Button value="no">Deny</Radio.Button>
                            </Radio.Group>
                        </Descriptions.Item>
                        <Descriptions.Item label="SSO authentication">
                            <Radio.Group
                                value={selectedOrg.flags.allow_sso ? "yes" : "no"}
                                size="small"
                                onChange={(e) =>
                                    handleFlagChange("allow_sso", e.target.value === "yes")
                                }
                                disabled={updating}
                            >
                                <Tooltip
                                    title={
                                        !hasActiveVerifiedProvider
                                            ? "Enable at least one SSO provider first."
                                            : null
                                    }
                                >
                                    <span>
                                        <Radio.Button
                                            value="yes"
                                            disabled={!hasActiveVerifiedProvider}
                                        >
                                            Allow
                                        </Radio.Button>
                                    </span>
                                </Tooltip>
                                <Radio.Button value="no">Deny</Radio.Button>
                            </Radio.Group>
                        </Descriptions.Item>
                        <Descriptions.Item label="Owner can bypass controls">
                            <Radio.Group
                                value={selectedOrg.flags.allow_root ? "yes" : "no"}
                                size="small"
                                onChange={(e) =>
                                    handleFlagChange("allow_root", e.target.value === "yes")
                                }
                                disabled={updating}
                            >
                                <Radio.Button value="yes">Allow</Radio.Button>
                                <Tooltip
                                    title={
                                        allAuthMethodsDisabled
                                            ? "Enable at least one authentication method first."
                                            : null
                                    }
                                >
                                    <span>
                                        <Radio.Button
                                            value="no"
                                            disabled={allAuthMethodsDisabled}
                                        >
                                            Deny
                                        </Radio.Button>
                                    </span>
                                </Tooltip>
                            </Radio.Group>
                        </Descriptions.Item>
                        <Descriptions.Item label="Join from non-verified domains">
                            <Radio.Group
                                value={selectedOrg.flags.domains_only ? "no" : "yes"}
                                size="small"
                                onChange={(e) =>
                                    handleFlagChange("domains_only", e.target.value === "no")
                                }
                                disabled={updating}
                            >
                                <Radio.Button value="yes">Allow</Radio.Button>
                                <Tooltip
                                    title={
                                        !hasVerifiedDomain
                                            ? "Verify at least one domain first."
                                            : null
                                    }
                                >
                                    <span>
                                        <Radio.Button
                                            value="no"
                                            disabled={!hasVerifiedDomain}
                                        >
                                            Deny
                                        </Radio.Button>
                                    </span>
                                </Tooltip>
                            </Radio.Group>
                        </Descriptions.Item>
                        <Descriptions.Item label="Auto-join from verified domains">
                            <Radio.Group
                                value={selectedOrg.flags.auto_join ? "yes" : "no"}
                                size="small"
                                onChange={(e) =>
                                    handleFlagChange("auto_join", e.target.value === "yes")
                                }
                                disabled={updating}
                            >
                                <Tooltip
                                    title={
                                        !hasVerifiedDomain
                                            ? "Verify at least one domain first."
                                            : null
                                    }
                                >
                                    <span>
                                        <Radio.Button
                                            value="yes"
                                            disabled={!hasVerifiedDomain}
                                        >
                                            Allow
                                        </Radio.Button>
                                    </span>
                                </Tooltip>
                                <Radio.Button value="no">Deny</Radio.Button>
                            </Radio.Group>
                        </Descriptions.Item>
                    </Descriptions>
                </Space>
            </Card>

            <Card>
                <Space direction="vertical" size="small" style={{width: "100%"}}>
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        <div>
                            <Title level={1} style={sectionTitleStyle}>
                                Verified Domains
                            </Title>
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
                        tableLayout="fixed"
                        className="no-expand-indent no-expand-col org-domains-table"
                        expandable={{
                            expandedRowKeys: pendingDomainRowKeys,
                            expandedRowRender: (record: OrganizationDomain) => {
                                // Only show DNS instructions for unverified domains with a token
                                if (record.flags?.is_verified || !record.token) {
                                    return null
                                }

                                const txtRecordName = `_agenta-verification.${record.slug}`
                                const txtRecordValue = `_agenta-verification=${record.token}`

                                return (
                                    <Alert
                                        message={
                                            <span style={{fontSize: "15px", fontWeight: 500}}>
                                                Verification Instructions
                                            </span>
                                        }
                                        description={
                                            <Space
                                                direction="vertical"
                                                size="middle"
                                                style={{width: "100%"}}
                                            >
                                                <Text style={{fontSize: "14px"}}>
                                                    1. Add the following DNS TXT record:
                                                </Text>
                                                <Descriptions
                                                    bordered
                                                    size="small"
                                                    column={1}
                                                    className="org-instructions"
                                                >
                                                    <Descriptions.Item
                                                        label={
                                                            <span
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                Type
                                                            </span>
                                                        }
                                                    >
                                                        <span
                                                            style={{
                                                                fontFamily: "monospace",
                                                                fontSize: "12px",
                                                            }}
                                                        >
                                                            TXT
                                                        </span>
                                                    </Descriptions.Item>
                                                    <Descriptions.Item
                                                        label={
                                                            <span
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                Host
                                                            </span>
                                                        }
                                                    >
                                                        <TooltipWithCopyAction
                                                            copyText={txtRecordName}
                                                            title="Copy host"
                                                        >
                                                            <span
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                {txtRecordName}
                                                            </span>
                                                        </TooltipWithCopyAction>
                                                    </Descriptions.Item>
                                                    <Descriptions.Item
                                                        label={
                                                            <span
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                Value
                                                            </span>
                                                        }
                                                    >
                                                        <TooltipWithCopyAction
                                                            copyText={txtRecordValue}
                                                            title="Copy value"
                                                        >
                                                            <span
                                                                className="break-all"
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                {txtRecordValue}
                                                            </span>
                                                        </TooltipWithCopyAction>
                                                    </Descriptions.Item>
                                                </Descriptions>
                                                <Text style={{fontSize: "14px"}}>
                                                    2. Wait a few minutes for DNS propagation.
                                                </Text>
                                                <Text style={{fontSize: "14px"}}>
                                                    3. Click the "Verify" button.
                                                </Text>
                                            </Space>
                                        }
                                        type="info"
                                        icon={<InfoCircleOutlined />}
                                        showIcon
                                    />
                                )
                            },
                            rowExpandable: (record: OrganizationDomain) =>
                                !record.flags?.is_verified && !!record.token,
                            expandIcon: () => null,
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
                                    pattern:
                                        /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/,
                                    message:
                                        "Please enter a valid domain (e.g., example.com or app.example.com)",
                                },
                            ]}
                        >
                            <Input placeholder="example.com or app.example.com" />
                        </Form.Item>
                        <Text type="secondary" style={{fontSize: "12px"}}>
                            After adding the domain, please follow the verification instructions.
                        </Text>
                    </Form>
                </Modal>
            </Card>

            <Card>
                <Space direction="vertical" size="small" style={{width: "100%"}}>
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        <div>
                            <Title level={1} style={sectionTitleStyle}>
                                SSO Providers
                            </Title>
                        </div>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => {
                                if (!selectedOrg?.slug) {
                                    setSlugValue("")
                                    setSlugModalVisible(true)
                                    return
                                }
                                setProviderModalVisible(true)
                            }}
                        >
                            {selectedOrg?.slug ? "Add Provider" : "Set Slug"}
                        </Button>
                    </div>
                    <Descriptions
                        size="small"
                        column={1}
                        bordered
                        className="org-kv-65-35 org-slug-row"
                    >
                        <Descriptions.Item label="Organization slug">
                            <div className="org-slug-content">
                                {selectedOrg.slug ? (
                                    <Text>{selectedOrg.slug}</Text>
                                ) : (
                                    <Text type="secondary">Please set slug to enable SSO</Text>
                                )}
                            </div>
                        </Descriptions.Item>
                    </Descriptions>
                    <Modal
                        title="Set organization slug"
                        open={slugModalVisible}
                        okText="Save"
                        onOk={handleSlugSave}
                        onCancel={() => setSlugModalVisible(false)}
                        confirmLoading={updating}
                    >
                        <Text type="secondary">
                            The slug is used in SSO callbacks and cannot be unset or edited once
                            saved.
                        </Text>
                        <Input
                            style={{marginTop: 12}}
                            value={slugValue}
                            onChange={(e) => setSlugValue(e.target.value)}
                            placeholder="organization-slug"
                        />
                    </Modal>
                    {!selectedOrg?.slug && (
                        <Alert
                            message="Set an organization slug before configuring SSO providers."
                            type="warning"
                            showIcon
                        />
                    )}

                    <Table
                        columns={providerColumns}
                        dataSource={providers}
                        rowKey="id"
                        pagination={false}
                        size="small"
                        tableLayout="fixed"
                        className="no-expand-indent no-expand-col org-providers-table"
                        expandable={{
                            expandedRowKeys: pendingProviderRowKeys,
                            expandedRowRender: (record: OrganizationProvider) => {
                                // Only show configuration instructions for providers that are not valid
                                if (record.flags?.is_valid !== false) {
                                    return null
                                }

                                if (!selectedOrg?.slug) {
                                    return null
                                }

                                const callbackUrl = `${getAgentaWebUrl()}/auth/callback/sso:${selectedOrg.slug}:${record.slug}`
                                const expectedScopes = "openid email profile"

                                return (
                                    <Alert
                                        message={
                                            <span style={{fontSize: "15px", fontWeight: 500}}>
                                                Configuration Instructions
                                            </span>
                                        }
                                        description={
                                            <Space
                                                direction="vertical"
                                                size="middle"
                                                style={{width: "100%"}}
                                            >
                                                <Text style={{fontSize: "14px"}}>
                                                    1. Edit your IdP with the following details:
                                                </Text>
                                                <Descriptions
                                                    bordered
                                                    size="small"
                                                    column={1}
                                                    className="org-instructions"
                                                >
                                                    <Descriptions.Item
                                                        label={
                                                            <span
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                Callback URL
                                                            </span>
                                                        }
                                                    >
                                                        <TooltipWithCopyAction
                                                            copyText={callbackUrl}
                                                            title="Copy callback URL"
                                                        >
                                                            <span
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                {callbackUrl}
                                                            </span>
                                                        </TooltipWithCopyAction>
                                                    </Descriptions.Item>
                                                    <Descriptions.Item
                                                        label={
                                                            <span
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                Scopes
                                                            </span>
                                                        }
                                                    >
                                                        <TooltipWithCopyAction
                                                            copyText={expectedScopes}
                                                            title="Copy scopes"
                                                        >
                                                            <span
                                                                style={{
                                                                    fontFamily: "monospace",
                                                                    fontSize: "12px",
                                                                }}
                                                            >
                                                                {expectedScopes}
                                                            </span>
                                                        </TooltipWithCopyAction>
                                                    </Descriptions.Item>
                                                </Descriptions>
                                                <Text style={{fontSize: "14px"}}>
                                                    2. Ensure your SSO provider's OIDC discovery
                                                    endpoint is accessible.
                                                </Text>
                                                <Text style={{fontSize: "14px"}}>
                                                    3. Click the "Enable" button.
                                                </Text>
                                            </Space>
                                        }
                                        type="info"
                                        icon={<InfoCircleOutlined />}
                                        showIcon
                                    />
                                )
                            },
                            rowExpandable: (record: OrganizationProvider) =>
                                record.flags?.is_valid === false,
                            expandIcon: () => null,
                        }}
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
                    confirmLoading={
                        createProviderMutation.isPending || updateProviderMutation.isPending
                    }
                    okText={editingProvider ? "Update" : "Add"}
                    width={600}
                >
                    <Form form={providerForm} layout="vertical" style={{marginTop: 16}}>
                        <Form.Item
                            name="slug"
                            label="Provider"
                            rules={[
                                {required: true, message: "Please enter a provider slug"},
                                {
                                    pattern: /^[a-z-]+$/,
                                    message:
                                        "Provider slug must contain only lowercase letters and hyphens",
                                },
                            ]}
                        >
                            <Input placeholder="my-idp" disabled={!!editingProvider} />
                        </Form.Item>
                        <Form.Item
                            label="Callback URL"
                            shouldUpdate={(prev, next) => prev.slug !== next.slug}
                        >
                            {() => {
                                const slug = providerForm.getFieldValue("slug")
                                const callbackUrl =
                                    selectedOrg?.slug && slug
                                        ? `${getAgentaWebUrl()}/auth/callback/sso:${selectedOrg.slug}:${slug}`
                                        : ""
                                return (
                                    <Input
                                        value={callbackUrl}
                                        placeholder="Set organization and provider slug"
                                        readOnly
                                    />
                                )
                            }}
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
                            After adding the provider, use the "Test" button to verify the
                            connection.
                        </Text>
                    </Form>
                </Modal>
            </Card>
        </Space>
    )
}

export default Organization
