import {type FC, useState, useCallback, useMemo} from "react"

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
} from "@agenta/entities/organization"
import {
    AccessControlsSection,
    DomainsSection,
    SsoProvidersSection,
    type AuthFlagKey,
} from "@agenta/settings-ui"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"
import {InfoCircleOutlined} from "@ant-design/icons"
import {useQueryClient, useQuery, useMutation} from "@tanstack/react-query"
import {Descriptions, Input, Modal, Skeleton, Typography, message, Form, Alert} from "antd"

import {getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {useOrgData} from "@/oss/state/org"

import {UpgradePrompt} from "./UpgradePrompt"

const {Text} = Typography

const Organization: FC = () => {
    const {selectedOrg, loading, refetch} = useOrgData()
    const {hasAccessControl, hasDomains, hasSSO, isLoading: entitlementsLoading} = useEntitlements()
    const queryClient = useQueryClient()
    const [slugValue, setSlugValue] = useState("")
    const [slugModalVisible, setSlugModalVisible] = useState(false)
    const [updating, setUpdating] = useState(false)
    const [lastSavedFlag, setLastSavedFlag] = useState<string | null>(null)
    const [domainModalVisible, setDomainModalVisible] = useState(false)
    const [domainForm] = Form.useForm()
    const [providerModalVisible, setProviderModalVisible] = useState(false)
    const [providerForm] = Form.useForm()
    const [editingProvider, setEditingProvider] = useState<string | null>(null)

    const handleUpdateOrganization = useCallback(
        async (
            payload: {slug?: string; name?: string; description?: string; flags?: any},
            options?: {ignoreAxiosError?: boolean; flagName?: string},
        ) => {
            if (!selectedOrg?.id) return

            setUpdating(true)
            try {
                const ignoreAxiosError = options?.ignoreAxiosError ?? Boolean(payload.flags)
                const updated = await updateOrganization(selectedOrg.id, payload, ignoreAxiosError)
                if (updated) {
                    queryClient.setQueryData(["selectedOrg", selectedOrg.id], updated)
                    queryClient.setQueriesData({queryKey: ["orgs"]}, (old: any) => {
                        if (!Array.isArray(old)) return old
                        return old.map((org) =>
                            org.id === updated.id ? {...org, ...updated} : org,
                        )
                    })
                }
                // Show inline success indicator for flag changes
                if (options?.flagName) {
                    setLastSavedFlag(options.flagName)
                    setTimeout(() => setLastSavedFlag(null), 2000)
                } else {
                    message.success("Organization updated successfully")
                }
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
    const {
        data: domains = [],
        refetch: refetchDomains,
        isPending: domainsLoading,
    } = useQuery({
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

    const callbackUrlForProvider = useCallback(
        (provider: OrganizationProvider) =>
            selectedOrg?.slug
                ? `${getAgentaWebUrl()}/auth/callback/sso:${selectedOrg.slug}:${provider.slug}`
                : null,
        [selectedOrg?.slug],
    )

    /** What to put in the IdP. Slotted under each provider that is not yet valid. */
    const renderProviderInstructions = useCallback(
        (record: OrganizationProvider) => {
            const callbackUrl = callbackUrlForProvider(record)
            if (!callbackUrl) return null
            const expectedScopes = "openid email profile"
            const mono = {fontFamily: "monospace", fontSize: "12px"} as const

            return (
                <Alert
                    type="info"
                    showIcon
                    icon={<InfoCircleOutlined />}
                    message={
                        <span style={{fontSize: "15px", fontWeight: 500}}>
                            Configuration Instructions
                        </span>
                    }
                    description={
                        <div className="flex w-full flex-col gap-4">
                            <Text style={{fontSize: "14px"}}>
                                1. Edit your IdP with the following details:
                            </Text>
                            <Descriptions
                                bordered
                                size="small"
                                column={1}
                                className="org-instructions"
                            >
                                <Descriptions.Item label={<span style={mono}>Callback URL</span>}>
                                    <TooltipWithCopyAction
                                        copyText={callbackUrl}
                                        title="Copy callback URL"
                                    >
                                        <span style={mono}>{callbackUrl}</span>
                                    </TooltipWithCopyAction>
                                </Descriptions.Item>
                                <Descriptions.Item label={<span style={mono}>Scopes</span>}>
                                    <TooltipWithCopyAction
                                        copyText={expectedScopes}
                                        title="Copy scopes"
                                    >
                                        <span style={mono}>{expectedScopes}</span>
                                    </TooltipWithCopyAction>
                                </Descriptions.Item>
                            </Descriptions>
                            <Text style={{fontSize: "14px"}}>
                                2. Ensure your SSO provider&apos;s OIDC discovery endpoint is
                                accessible.
                            </Text>
                            <Text style={{fontSize: "14px"}}>
                                3. Click the &quot;Enable&quot; button.
                            </Text>
                        </div>
                    }
                />
            )
        },
        [callbackUrlForProvider],
    )

    /** The DNS record to publish, and what to do after. Slotted under each pending domain. */
    const renderDomainInstructions = useCallback((record: OrganizationDomain) => {
        const txtRecordName = `_agenta-verification.${record.slug}`
        const txtRecordValue = `_agenta-verification=${record.token}`
        const mono = {fontFamily: "monospace", fontSize: "12px"} as const

        return (
            <Alert
                type="info"
                showIcon
                icon={<InfoCircleOutlined />}
                message={
                    <span style={{fontSize: "15px", fontWeight: 500}}>
                        Verification Instructions
                    </span>
                }
                description={
                    <div className="flex w-full flex-col gap-4">
                        <Text style={{fontSize: "14px"}}>1. Add the following DNS TXT record:</Text>
                        <Descriptions bordered size="small" column={1} className="org-instructions">
                            <Descriptions.Item label={<span style={mono}>Type</span>}>
                                <span style={mono}>TXT</span>
                            </Descriptions.Item>
                            <Descriptions.Item label={<span style={mono}>Host</span>}>
                                <div>
                                    <TooltipWithCopyAction
                                        copyText={txtRecordName}
                                        title="Copy host"
                                    >
                                        <span style={mono}>{txtRecordName}</span>
                                    </TooltipWithCopyAction>
                                    <div style={{marginTop: 4}}>
                                        <Text type="secondary" style={{fontSize: "11px"}}>
                                            Some DNS providers (e.g. Namecheap, GoDaddy, Cloudflare)
                                            automatically append your domain. If so, enter only:{" "}
                                            <Text code style={{fontSize: "11px"}}>
                                                _agenta-verification
                                            </Text>
                                        </Text>
                                    </div>
                                </div>
                            </Descriptions.Item>
                            <Descriptions.Item label={<span style={mono}>Value</span>}>
                                <TooltipWithCopyAction copyText={txtRecordValue} title="Copy value">
                                    <span style={mono}>{txtRecordValue}</span>
                                </TooltipWithCopyAction>
                            </Descriptions.Item>
                        </Descriptions>
                        <Text style={{fontSize: "14px"}}>
                            2. Wait a few minutes for DNS propagation.
                        </Text>
                        <Text style={{fontSize: "14px"}}>
                            3. Click the &quot;Verify&quot; button.
                        </Text>
                    </div>
                }
            />
        )
    }, [])

    // SSO Provider queries and mutations
    const {
        data: providers = [],
        refetch: refetchProviders,
        isPending: providersLoading,
    } = useQuery({
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

    const hasActiveVerifiedProvider = useMemo(
        () => providers.some((provider) => provider.flags?.is_active && provider.flags?.is_valid),
        [providers],
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
                                    To prevent lockout, the "Owners bypass restrictions" setting
                                    will be enabled automatically.
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
                            {ignoreAxiosError: true, flagName: flag},
                        )
                    },
                })
            } else {
                handleUpdateOrganization({flags: {[flag]: value}}, {flagName: flag})
            }
        },
        [handleUpdateOrganization, hasActiveVerifiedProvider, hasVerifiedDomain, selectedOrg],
    )

    if (loading || entitlementsLoading) {
        return (
            <div className="flex w-full flex-col gap-8">
                <section>
                    <Skeleton active paragraph={{rows: 6}} />
                </section>
                <section>
                    <Skeleton active paragraph={{rows: 4}} />
                </section>
            </div>
        )
    }

    if (!selectedOrg) {
        return <div>No organization selected</div>
    }

    return (
        <div className="flex w-full flex-col gap-8">
            {hasAccessControl ? (
                <AccessControlsSection
                    flags={selectedOrg.flags}
                    onFlagChange={handleFlagChange}
                    updating={updating}
                    lastSavedFlag={lastSavedFlag as AuthFlagKey | null}
                    hasActiveVerifiedProvider={hasActiveVerifiedProvider}
                    hasVerifiedDomain={hasVerifiedDomain}
                />
            ) : (
                <UpgradePrompt
                    title="Access Controls"
                    description="Control how members sign in and who can join this organization."
                />
            )}

            {hasDomains ? (
                <section>
                    <DomainsSection
                        domains={domains ?? []}
                        loading={domainsLoading}
                        onAdd={() => setDomainModalVisible(true)}
                        onVerify={(domain: OrganizationDomain) =>
                            verifyDomainMutation.mutate(domain.id)
                        }
                        onRefreshToken={(domain: OrganizationDomain) =>
                            refreshDomainTokenMutation.mutate(domain.id)
                        }
                        onDelete={(domain: OrganizationDomain) =>
                            deleteDomainMutation.mutate(domain.id)
                        }
                        verifying={verifyDomainMutation.isPending}
                        refreshing={refreshDomainTokenMutation.isPending}
                        deleting={deleteDomainMutation.isPending}
                        renderInstructions={renderDomainInstructions}
                    />

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
                                After adding the domain, please follow the verification
                                instructions.
                            </Text>
                        </Form>
                    </Modal>
                </section>
            ) : (
                <UpgradePrompt
                    title="Verified Domains"
                    description="Verify domains your organization owns, then use them for access rules and auto-join."
                />
            )}

            {hasSSO ? (
                <section>
                    <SsoProvidersSection
                        providers={providers ?? []}
                        loading={providersLoading}
                        callbackUrlFor={callbackUrlForProvider}
                        addLabel={selectedOrg?.slug ? "Add Provider" : "Set Slug"}
                        onAdd={() => {
                            if (!selectedOrg?.slug) {
                                setSlugValue("")
                                setSlugModalVisible(true)
                                return
                            }
                            setProviderModalVisible(true)
                        }}
                        onEdit={handleEditProvider}
                        onEnable={(provider: OrganizationProvider) =>
                            testProviderMutation.mutate(provider.id)
                        }
                        onDelete={(provider: OrganizationProvider) =>
                            deleteProviderMutation.mutate(provider.id)
                        }
                        enabling={testProviderMutation.isPending}
                        deleting={deleteProviderMutation.isPending}
                        renderInstructions={renderProviderInstructions}
                    >
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
                    </SsoProvidersSection>

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
                                rules={[
                                    {required: true, message: "Please enter the client secret"},
                                ]}
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
                                After adding the provider, click Enable in the table to verify the
                                connection.
                            </Text>
                        </Form>
                    </Modal>
                </section>
            ) : (
                <UpgradePrompt
                    title="SSO Providers"
                    description="Connect an OIDC identity provider so members sign in through single sign-on (SSO)."
                />
            )}
        </div>
    )
}

export default Organization
