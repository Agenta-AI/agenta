import {type FC, useCallback, useMemo, useState} from "react"

import {Alert, AlertDescription, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@agenta/primitive-ui/components/card"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Form, FormField, useAppForm} from "@agenta/primitive-ui/components/form"
import {Input} from "@agenta/primitive-ui/components/input"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Switch} from "@agenta/primitive-ui/components/switch"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {toast} from "@agenta/primitive-ui/lib/toast"
import {ConfirmDialog, type ConfirmRequest} from "@agenta/ui/components/modal"
import {
    CheckCircle,
    Clock,
    Copy,
    Info,
    Lock,
    PencilSimple,
    Plus,
    ArrowClockwise,
    Trash,
} from "@phosphor-icons/react"
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query"
import {z} from "zod"

import {getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {
    createOrganizationDomain,
    createOrganizationProvider,
    deleteOrganizationDomain,
    deleteOrganizationProvider,
    fetchOrganizationDomains,
    fetchOrganizationProviders,
    refreshOrganizationDomainToken,
    testOrganizationProvider,
    updateOrganization,
    updateOrganizationProvider,
    verifyOrganizationDomain,
    type OrganizationDomain,
    type OrganizationProvider,
} from "@/oss/services/organization/api"
import {useOrgData} from "@/oss/state/org"

import {UpgradePrompt} from "./UpgradePrompt"

interface SettingRowProps {
    title: string
    description: string
    enabled: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
    disabledReason?: string
    tooltip?: string
    loading?: boolean
    showSuccess?: boolean
}

interface LegacyProvider extends OrganizationProvider {
    settings: {
        issuer_url: string
        client_id: string
        client_secret: string
        scopes?: string[]
    }
    flags: OrganizationProvider["flags"] & {is_enabled?: boolean}
}

const domainSchema = z.object({
    domain: z
        .string()
        .min(1, "Please enter a domain")
        .regex(
            /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/,
            "Please enter a valid domain (e.g., example.com or app.example.com)",
        ),
})

const providerSchema = z.object({
    slug: z
        .string()
        .min(1, "Please enter a provider slug")
        .regex(/^[a-z-]+$/, "Provider slug must contain only lowercase letters and hyphens"),
    issuer_url: z.url("Please enter a valid URL"),
    client_id: z.string().min(1, "Please enter the client ID"),
    client_secret: z.string().min(1, "Please enter the client secret"),
    scopes: z.string(),
})

type ProviderFormValues = z.input<typeof providerSchema>

const getErrorMessage = (error: unknown, fallback: string) => {
    if (typeof error !== "object" || error === null) return fallback
    const response = "response" in error ? error.response : undefined
    if (typeof response !== "object" || response === null || !("data" in response)) {
        return "message" in error && typeof error.message === "string" ? error.message : fallback
    }
    const data = response.data
    if (typeof data !== "object" || data === null || !("detail" in data)) return fallback
    return typeof data.detail === "string" ? data.detail : fallback
}

const SettingRow: FC<SettingRowProps> = ({
    title,
    description,
    enabled,
    onChange,
    disabled,
    disabledReason,
    tooltip,
    loading,
    showSuccess,
}) => (
    <div
        className={`flex items-start justify-between border-b border-border py-4 last:border-0 ${disabled ? "opacity-60" : ""}`}
    >
        <div className="flex-1 pr-8">
            <div className="flex items-center gap-2">
                <h4 className="m-0 text-sm font-medium">{title}</h4>
                {tooltip ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`About ${title}`}
                                />
                            }
                        >
                            <Info />
                        </TooltipTrigger>
                        <TooltipContent>{tooltip}</TooltipContent>
                    </Tooltip>
                ) : null}
                {showSuccess ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <CheckCircle />
                        Saved
                    </span>
                ) : null}
            </div>
            <p className="mb-0 mt-0.5 text-sm text-muted-foreground">{description}</p>
            {disabled && disabledReason ? (
                <p className="mb-0 mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <Lock size={14} />
                    {disabledReason}
                </p>
            ) : null}
        </div>
        <div className="flex min-h-8 items-center gap-2">
            {loading ? <Spinner /> : null}
            <Switch
                checked={enabled}
                onCheckedChange={onChange}
                disabled={disabled || loading}
                aria-label={title}
            />
        </div>
    </div>
)

const SectionLabel: FC<{children: React.ReactNode}> = ({children}) => (
    <p className="m-0 pb-2 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {children}
    </p>
)

const CopyValue = ({value, label}: {value: string; label: string}) => (
    <div className="flex min-w-0 items-center gap-2">
        <code className="break-all text-xs">{value}</code>
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Copy ${label}`}
                        onClick={() => navigator.clipboard.writeText(value)}
                    />
                }
            >
                <Copy />
            </TooltipTrigger>
            <TooltipContent>Copy {label}</TooltipContent>
        </Tooltip>
    </div>
)

const KeyValueRow = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] border-b border-border last:border-b-0">
        <code className="bg-muted px-3 py-2 text-xs">{label}</code>
        <div className="min-w-0 px-3 py-2">{children}</div>
    </div>
)

const DomainInstructions = ({domain}: {domain: OrganizationDomain}) => {
    if (domain.flags?.is_verified || !domain.token) return null

    const txtRecordName = `_agenta-verification.${domain.slug}`
    const txtRecordValue = `_agenta-verification=${domain.token}`

    return (
        <Alert>
            <Info />
            <AlertTitle>Verification Instructions</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 text-foreground">
                <span>1. Add the following DNS TXT record:</span>
                <div className="overflow-hidden rounded-lg border border-border">
                    <KeyValueRow label="Type">
                        <code className="text-xs">TXT</code>
                    </KeyValueRow>
                    <KeyValueRow label="Host">
                        <CopyValue value={txtRecordName} label="host" />
                        <p className="mb-0 mt-1 text-xs text-muted-foreground">
                            Some DNS providers automatically append your domain. If so, enter only:{" "}
                            <code>_agenta-verification</code>
                        </p>
                    </KeyValueRow>
                    <KeyValueRow label="Value">
                        <CopyValue value={txtRecordValue} label="value" />
                    </KeyValueRow>
                </div>
                <span>2. Wait a few minutes for DNS propagation.</span>
                <span>3. Click the &quot;Verify&quot; button.</span>
            </AlertDescription>
        </Alert>
    )
}

const ProviderInstructions = ({
    provider,
    organizationSlug,
}: {
    provider: LegacyProvider
    organizationSlug?: string | null
}) => {
    if (provider.flags?.is_valid !== false || !organizationSlug) return null

    const callbackUrl = `${getAgentaWebUrl()}/auth/callback/sso:${organizationSlug}:${provider.slug}`
    const expectedScopes = "openid email profile"

    return (
        <Alert>
            <Info />
            <AlertTitle>Configuration Instructions</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 text-foreground">
                <span>1. Edit your IdP with the following details:</span>
                <div className="overflow-hidden rounded-lg border border-border">
                    <KeyValueRow label="Callback URL">
                        <CopyValue value={callbackUrl} label="callback URL" />
                    </KeyValueRow>
                    <KeyValueRow label="Scopes">
                        <CopyValue value={expectedScopes} label="scopes" />
                    </KeyValueRow>
                </div>
                <span>
                    2. Ensure your SSO provider&apos;s OIDC discovery endpoint is accessible.
                </span>
                <span>3. Click the &quot;Enable&quot; button.</span>
            </AlertDescription>
        </Alert>
    )
}

const Organization: FC = () => {
    const {selectedOrg, loading, refetch} = useOrgData()
    const {hasAccessControl, hasDomains, hasSSO, isLoading: entitlementsLoading} = useEntitlements()
    const queryClient = useQueryClient()
    const [slugValue, setSlugValue] = useState("")
    const [slugModalVisible, setSlugModalVisible] = useState(false)
    const [updating, setUpdating] = useState(false)
    const [lastSavedFlag, setLastSavedFlag] = useState<string | null>(null)
    const [domainModalVisible, setDomainModalVisible] = useState(false)
    const [providerModalVisible, setProviderModalVisible] = useState(false)
    const [editingProvider, setEditingProvider] = useState<string | null>(null)
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
    const domainForm = useAppForm({schema: domainSchema, defaultValues: {domain: ""}})
    const providerForm = useAppForm({
        schema: providerSchema,
        defaultValues: {
            slug: "",
            issuer_url: "",
            client_id: "",
            client_secret: "",
            scopes: "openid, profile, email",
        },
    })
    const providerSlug = providerForm.watch("slug")

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
                if (options?.flagName) {
                    setLastSavedFlag(options.flagName)
                    setTimeout(() => setLastSavedFlag(null), 2000)
                } else {
                    toast.success("Organization updated successfully")
                }
                await queryClient.invalidateQueries({queryKey: ["organizations"]})
                await refetch()
            } catch (error) {
                toast.error(getErrorMessage(error, "Failed to update organization"))
                console.error("Failed to update organization:", error)
            } finally {
                setUpdating(false)
            }
        },
        [queryClient, refetch, selectedOrg?.id],
    )

    const {data: domains = [], refetch: refetchDomains} = useQuery({
        queryKey: ["organization-domains", selectedOrg?.id],
        queryFn: fetchOrganizationDomains,
        enabled: !!selectedOrg?.id,
    })
    const hasVerifiedDomain = useMemo(
        () => domains.some((domain) => domain.flags?.is_verified),
        [domains],
    )

    const {data: providerData = [], refetch: refetchProviders} = useQuery({
        queryKey: ["organization-providers", selectedOrg?.id],
        queryFn: fetchOrganizationProviders,
        enabled: !!selectedOrg?.id,
    })
    const providers = providerData as LegacyProvider[]

    const createDomainMutation = useMutation({
        mutationFn: (values: z.input<typeof domainSchema>) =>
            createOrganizationDomain({domain: values.domain} as never),
        onSuccess: () => {
            toast.success("Domain added successfully. Token is available in the table.")
            refetchDomains()
            setDomainModalVisible(false)
            domainForm.reset()
        },
        onError: (error) => toast.error(getErrorMessage(error, "Failed to add domain")),
    })

    const verifyDomainMutation = useMutation({
        mutationFn: verifyOrganizationDomain,
        onSuccess: () => {
            toast.success("Domain verified successfully")
            refetchDomains()
        },
        onError: (error) => toast.error(getErrorMessage(error, "Failed to verify domain")),
    })

    const refreshDomainTokenMutation = useMutation({
        mutationFn: refreshOrganizationDomainToken,
        onSuccess: () => {
            toast.success("Token refreshed successfully")
            refetchDomains()
        },
        onError: (error) => toast.error(getErrorMessage(error, "Failed to refresh token")),
    })

    const deleteDomainMutation = useMutation({
        mutationFn: deleteOrganizationDomain,
        onSuccess: () => {
            toast.success("Domain deleted successfully")
            refetchDomains()
        },
        onError: (error) => toast.error(getErrorMessage(error, "Failed to delete domain")),
    })

    const createProviderMutation = useMutation({
        mutationFn: (payload: unknown) => createOrganizationProvider(payload as never),
        onSuccess: () => {
            toast.success("SSO provider added successfully")
            refetchProviders()
            setProviderModalVisible(false)
            setEditingProvider(null)
            providerForm.reset()
        },
        onError: (error) => toast.error(getErrorMessage(error, "Failed to add SSO provider")),
        throwOnError: false,
    })

    const updateProviderMutation = useMutation({
        mutationFn: ({providerId, payload}: {providerId: string; payload: unknown}) =>
            updateOrganizationProvider(providerId, payload as never),
        onSuccess: () => {
            toast.success("SSO provider updated successfully")
            refetchProviders()
            setProviderModalVisible(false)
            setEditingProvider(null)
            providerForm.reset()
        },
        onError: (error) => toast.error(getErrorMessage(error, "Failed to update SSO provider")),
        throwOnError: false,
    })

    const testProviderMutation = useMutation({
        mutationFn: testOrganizationProvider,
        onSuccess: () => {
            toast.success("SSO provider connection test successful")
            refetchProviders()
        },
        onError: (error) =>
            toast.error(getErrorMessage(error, "SSO provider connection test failed")),
        throwOnError: false,
    })

    const deleteProviderMutation = useMutation({
        mutationFn: deleteOrganizationProvider,
        onSuccess: () => {
            toast.success("SSO provider deleted successfully")
            refetchProviders()
        },
        onError: (error) => toast.error(getErrorMessage(error, "Failed to delete SSO provider")),
        throwOnError: false,
    })

    const handleSlugSave = useCallback(() => {
        if (!slugValue.trim()) return
        handleUpdateOrganization({slug: slugValue.trim()}, {ignoreAxiosError: true})
        setSlugModalVisible(false)
    }, [handleUpdateOrganization, slugValue])

    const handleAddOrUpdateProvider = useCallback(
        (values: ProviderFormValues) => {
            if (!selectedOrg?.slug) {
                toast.error("Set an organization slug before configuring SSO providers.")
                return
            }
            const payload = {
                slug: values.slug,
                settings: {
                    issuer_url: values.issuer_url,
                    client_id: values.client_id,
                    client_secret: values.client_secret,
                    scopes: values.scopes?.split(",").map((scope) => scope.trim()) || [
                        "openid",
                        "profile",
                        "email",
                    ],
                },
            }

            if (editingProvider) {
                updateProviderMutation.mutate({providerId: editingProvider, payload})
            } else {
                createProviderMutation.mutate(payload)
            }
        },
        [createProviderMutation, editingProvider, selectedOrg?.slug, updateProviderMutation],
    )

    const handleEditProvider = useCallback(
        (provider: LegacyProvider) => {
            setEditingProvider(provider.id)
            providerForm.reset({
                slug: provider.slug,
                issuer_url: provider.settings.issuer_url,
                client_id: provider.settings.client_id,
                client_secret: provider.settings.client_secret,
                scopes: provider.settings.scopes?.join(", ") || "openid, profile, email",
            })
            setProviderModalVisible(true)
        },
        [providerForm],
    )

    const hasActiveVerifiedProvider = useMemo(
        () => providers.some((provider) => provider.flags?.is_active && provider.flags?.is_valid),
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
                toast.error("Enable at least one active SSO provider before allowing SSO.")
                return
            }
            if (flag === "domains_only" && value && !hasVerifiedDomain) {
                toast.error("Verify at least one domain before enforcing verified domains only.")
                return
            }
            if (flag === "auto_join" && value && !hasVerifiedDomain) {
                toast.error("Auto-join requires at least one verified domain.")
                return
            }

            const currentFlags = selectedOrg.flags
            const allowEmail = flag === "allow_email" ? value : currentFlags.allow_email
            const allowSocial = flag === "allow_social" ? value : currentFlags.allow_social
            const allowSso = flag === "allow_sso" ? value : currentFlags.allow_sso
            const wouldDisableAllAuthWithoutBypass =
                !allowEmail && !allowSocial && !allowSso && !currentFlags.allow_root

            if (wouldDisableAllAuthWithoutBypass && !value) {
                setConfirm({
                    title: "Disable all authentication methods?",
                    message: (
                        <div className="flex flex-col gap-2">
                            <p>
                                You are about to disable all authentication methods for this
                                organization.
                            </p>
                            <p className="font-semibold">
                                To prevent lockout, the &quot;Owner can bypass controls&quot; flag
                                will be enabled automatically.
                            </p>
                            <p>Do you want to continue?</p>
                        </div>
                    ),
                    okText: "Confirm",
                    danger: true,
                    onOk: () =>
                        handleUpdateOrganization(
                            {flags: {[flag]: value}},
                            {ignoreAxiosError: true, flagName: flag},
                        ),
                })
            } else {
                handleUpdateOrganization({flags: {[flag]: value}}, {flagName: flag})
            }
        },
        [handleUpdateOrganization, hasActiveVerifiedProvider, hasVerifiedDomain, selectedOrg],
    )

    const domainColumns = useMemo<ColumnDef<OrganizationDomain, unknown>[]>(
        () => [
            {id: "domain", accessorKey: "slug", header: "Domain", enableSorting: false},
            {
                id: "expiration",
                header: "Expiration",
                enableSorting: false,
                cell: ({row}) => {
                    const domain = row.original
                    if (domain.flags?.is_verified)
                        return <span className="text-muted-foreground">-</span>
                    const expiresAt = new Date(
                        new Date(domain.created_at).getTime() + 48 * 60 * 60 * 1000,
                    )
                    const isExpired = new Date() > expiresAt
                    return (
                        <span className={isExpired ? "text-destructive" : "text-muted-foreground"}>
                            {expiresAt.toLocaleString()}
                            {isExpired ? " (Expired)" : ""}
                        </span>
                    )
                },
            },
            {
                id: "status",
                header: "Status",
                enableSorting: false,
                cell: ({row}) =>
                    row.original.flags?.is_verified ? (
                        <Badge variant="secondary">
                            <CheckCircle />
                            Verified
                        </Badge>
                    ) : (
                        <Badge variant="outline">
                            <Clock />
                            Pending
                        </Badge>
                    ),
            },
            {
                id: "actions",
                header: "Actions",
                enableSorting: false,
                cell: ({row}) => {
                    const domain = row.original
                    return (
                        <div className="flex items-center gap-1">
                            {!domain.flags?.is_verified ? (
                                <Button
                                    size="sm"
                                    disabled={verifyDomainMutation.isPending}
                                    onClick={() => verifyDomainMutation.mutate(domain.id)}
                                >
                                    {verifyDomainMutation.isPending ? <Spinner /> : null}
                                    Verify
                                </Button>
                            ) : null}
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label="Refresh token"
                                            disabled={refreshDomainTokenMutation.isPending}
                                            onClick={() =>
                                                refreshDomainTokenMutation.mutate(domain.id)
                                            }
                                        />
                                    }
                                >
                                    {refreshDomainTokenMutation.isPending ? (
                                        <Spinner />
                                    ) : (
                                        <ArrowClockwise />
                                    )}
                                </TooltipTrigger>
                                <TooltipContent>Refresh token</TooltipContent>
                            </Tooltip>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Delete domain"
                                disabled={deleteDomainMutation.isPending}
                                onClick={() =>
                                    setConfirm({
                                        title: "Delete domain",
                                        message: "Are you sure you want to delete this domain?",
                                        okText: "Delete",
                                        danger: true,
                                        onOk: () => deleteDomainMutation.mutateAsync(domain.id),
                                    })
                                }
                            >
                                {deleteDomainMutation.isPending ? <Spinner /> : <Trash />}
                            </Button>
                        </div>
                    )
                },
            },
        ],
        [deleteDomainMutation, refreshDomainTokenMutation, verifyDomainMutation],
    )

    const providerColumns = useMemo<ColumnDef<LegacyProvider, unknown>[]>(
        () => [
            {id: "provider", accessorKey: "slug", header: "Provider", enableSorting: false},
            {
                id: "callback_url",
                header: "Callback URL",
                enableSorting: false,
                cell: ({row}) =>
                    selectedOrg?.slug ? (
                        <span className="block max-w-[300px] truncate">
                            {`${getAgentaWebUrl()}/auth/callback/sso:${selectedOrg.slug}:${row.original.slug}`}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">Set org slug</span>
                    ),
            },
            {
                id: "status",
                header: "Status",
                enableSorting: false,
                cell: ({row}) => {
                    const provider = row.original
                    const isEnabled = provider.flags?.is_enabled !== false
                    const isValid = provider.flags?.is_valid !== false
                    if (!isEnabled) return <Badge variant="outline">Disabled</Badge>
                    return isValid ? (
                        <Badge variant="secondary">
                            <CheckCircle />
                            Active
                        </Badge>
                    ) : (
                        <Badge variant="outline">
                            <Clock />
                            Pending
                        </Badge>
                    )
                },
            },
            {
                id: "actions",
                header: "Actions",
                enableSorting: false,
                cell: ({row}) => {
                    const provider = row.original
                    const isEnabled = provider.flags?.is_enabled !== false
                    const isValid = provider.flags?.is_valid !== false
                    return (
                        <div className="flex items-center gap-1">
                            {!isEnabled || !isValid ? (
                                <Button
                                    size="sm"
                                    disabled={testProviderMutation.isPending}
                                    onClick={() => testProviderMutation.mutate(provider.id)}
                                >
                                    {testProviderMutation.isPending ? <Spinner /> : null}
                                    Enable
                                </Button>
                            ) : null}
                            <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label="Edit provider"
                                onClick={() => handleEditProvider(provider)}
                            >
                                <PencilSimple />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Delete SSO provider"
                                disabled={deleteProviderMutation.isPending}
                                onClick={() =>
                                    setConfirm({
                                        title: "Delete SSO provider",
                                        message:
                                            "Are you sure you want to delete this SSO provider?",
                                        okText: "Delete",
                                        danger: true,
                                        onOk: () => deleteProviderMutation.mutateAsync(provider.id),
                                    })
                                }
                            >
                                {deleteProviderMutation.isPending ? <Spinner /> : <Trash />}
                            </Button>
                        </div>
                    )
                },
            },
        ],
        [deleteProviderMutation, handleEditProvider, selectedOrg?.slug, testProviderMutation],
    )

    const closeProviderModal = () => {
        setProviderModalVisible(false)
        setEditingProvider(null)
        providerForm.reset()
    }

    if (loading || entitlementsLoading) {
        return (
            <div className="flex w-full flex-col gap-4">
                <Card>
                    <CardContent className="flex flex-col gap-3">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-40 w-full" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex flex-col gap-3">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-28 w-full" />
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (!selectedOrg) return <div>No organization selected</div>

    return (
        <div className="flex w-full flex-col gap-4">
            {hasAccessControl ? (
                <Card>
                    <CardHeader className="border-b">
                        <CardTitle className="text-xl">Access Controls</CardTitle>
                        <CardDescription>
                            Configure how users authenticate and join your organization
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <SectionLabel>Sign-in methods</SectionLabel>
                        <SettingRow
                            title="Email & password"
                            description="Members can sign in with their email and a password"
                            enabled={selectedOrg.flags.allow_email}
                            onChange={(checked) => handleFlagChange("allow_email", checked)}
                            loading={updating}
                            showSuccess={lastSavedFlag === "allow_email"}
                        />
                        <SettingRow
                            title="Social login"
                            description="Allow sign-in with Google, GitHub, or other OAuth providers"
                            enabled={selectedOrg.flags.allow_social}
                            onChange={(checked) => handleFlagChange("allow_social", checked)}
                            loading={updating}
                            showSuccess={lastSavedFlag === "allow_social"}
                        />
                        <SettingRow
                            title="SSO authentication"
                            description="Enable single sign-on through your identity provider"
                            enabled={selectedOrg.flags.allow_sso}
                            onChange={(checked) => handleFlagChange("allow_sso", checked)}
                            disabled={!hasActiveVerifiedProvider}
                            disabledReason="Add an SSO provider below to enable"
                            tooltip="OIDC supported. Configure your IdP in the SSO Providers section below."
                            loading={updating}
                            showSuccess={lastSavedFlag === "allow_sso"}
                        />
                        <SectionLabel>Membership</SectionLabel>
                        <SettingRow
                            title="Auto-join from verified domains"
                            description="Users with a verified domain email are automatically added to this organization"
                            enabled={selectedOrg.flags.auto_join}
                            onChange={(checked) => handleFlagChange("auto_join", checked)}
                            disabled={!hasVerifiedDomain}
                            disabledReason="Verify at least one domain first"
                            loading={updating}
                            showSuccess={lastSavedFlag === "auto_join"}
                        />
                        <SettingRow
                            title="Restrict invites to verified domains"
                            description="Only allow inviting users whose email matches a verified domain"
                            enabled={selectedOrg.flags.domains_only}
                            onChange={(checked) => handleFlagChange("domains_only", checked)}
                            disabled={!hasVerifiedDomain}
                            disabledReason="Verify at least one domain first"
                            loading={updating}
                            showSuccess={lastSavedFlag === "domains_only"}
                        />
                        <SectionLabel>Admin</SectionLabel>
                        <SettingRow
                            title="Owners bypass restrictions"
                            description="Owners can sign in and invite members regardless of the restrictions above"
                            enabled={selectedOrg.flags.allow_root}
                            onChange={(checked) => handleFlagChange("allow_root", checked)}
                            disabled={allAuthMethodsDisabled && selectedOrg.flags.allow_root}
                            disabledReason="Enable at least one sign-in method first"
                            tooltip="Prevents account lockout. Keep enabled if all sign-in methods are disabled."
                            loading={updating}
                            showSuccess={lastSavedFlag === "allow_root"}
                        />
                    </CardContent>
                </Card>
            ) : (
                <UpgradePrompt
                    title="Access Controls"
                    description="Configure how users authenticate and join your organization with sign-in methods, membership rules, and admin controls."
                />
            )}

            {hasDomains ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl">Verified Domains</CardTitle>
                        <CardDescription>Domains that belong to your organization</CardDescription>
                        <CardAction>
                            <Button onClick={() => setDomainModalVisible(true)}>
                                <Plus />
                                Add Domain
                            </Button>
                        </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <DataTable
                            columns={domainColumns}
                            data={domains}
                            getRowId={(domain) => domain.id}
                            enableSorting={false}
                        />
                        {domains.map((domain) => (
                            <DomainInstructions key={domain.id} domain={domain} />
                        ))}
                    </CardContent>
                </Card>
            ) : (
                <UpgradePrompt
                    title="Verified Domains"
                    description="Verify domains that belong to your organization to enable domain-based access controls and auto-join features."
                />
            )}

            {hasSSO ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl">SSO Providers</CardTitle>
                        <CardDescription>
                            Configure identity providers for single sign-on
                        </CardDescription>
                        <CardAction>
                            <Button
                                onClick={() => {
                                    if (!selectedOrg.slug) {
                                        setSlugValue("")
                                        setSlugModalVisible(true)
                                        return
                                    }
                                    setProviderModalVisible(true)
                                }}
                            >
                                <Plus />
                                {selectedOrg.slug ? "Add Provider" : "Set Slug"}
                            </Button>
                        </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <div className="overflow-hidden rounded-lg border border-border">
                            <KeyValueRow label="Organization slug">
                                {selectedOrg.slug || (
                                    <span className="text-muted-foreground">
                                        Please set slug to enable SSO
                                    </span>
                                )}
                            </KeyValueRow>
                        </div>
                        {!selectedOrg.slug ? (
                            <Alert>
                                <Info />
                                <AlertTitle>
                                    Set an organization slug before configuring SSO providers.
                                </AlertTitle>
                            </Alert>
                        ) : null}
                        <DataTable
                            columns={providerColumns}
                            data={providers}
                            getRowId={(provider) => provider.id}
                            enableSorting={false}
                        />
                        {providers.map((provider) => (
                            <ProviderInstructions
                                key={provider.id}
                                provider={provider}
                                organizationSlug={selectedOrg.slug}
                            />
                        ))}
                    </CardContent>
                </Card>
            ) : (
                <UpgradePrompt
                    title="SSO Providers"
                    description="Configure identity providers for single sign-on (SSO) using OIDC to enable enterprise-grade authentication for your organization."
                />
            )}

            <Dialog
                open={domainModalVisible}
                onOpenChange={(open) => {
                    if (!open) {
                        setDomainModalVisible(false)
                        domainForm.reset()
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Domain</DialogTitle>
                    </DialogHeader>
                    <Form
                        id="add-domain-form"
                        form={domainForm}
                        onSubmit={(values) => createDomainMutation.mutate(values)}
                    >
                        <FormField name="domain" label="Domain" required>
                            {(field) => (
                                <Input {...field} placeholder="example.com or app.example.com" />
                            )}
                        </FormField>
                        <p className="text-xs text-muted-foreground">
                            After adding the domain, please follow the verification instructions.
                        </p>
                    </Form>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setDomainModalVisible(false)
                                domainForm.reset()
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            form="add-domain-form"
                            disabled={createDomainMutation.isPending}
                        >
                            {createDomainMutation.isPending ? <Spinner /> : null}Add
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={slugModalVisible} onOpenChange={setSlugModalVisible}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Set organization slug</DialogTitle>
                        <DialogDescription>
                            The slug is used in SSO callbacks and cannot be unset or edited once
                            saved.
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        value={slugValue}
                        onChange={(event) => setSlugValue(event.target.value)}
                        placeholder="organization-slug"
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSlugModalVisible(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSlugSave} disabled={updating}>
                            {updating ? <Spinner /> : null}Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={providerModalVisible}
                onOpenChange={(open) => {
                    if (!open) closeProviderModal()
                }}
            >
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle>
                            {editingProvider ? "Edit SSO Provider" : "Add SSO Provider"}
                        </DialogTitle>
                    </DialogHeader>
                    <Form
                        id="provider-form"
                        form={providerForm}
                        onSubmit={handleAddOrUpdateProvider}
                    >
                        <FormField name="slug" label="Provider" required>
                            {(field) => (
                                <Input
                                    {...field}
                                    placeholder="my-idp"
                                    disabled={!!editingProvider}
                                />
                            )}
                        </FormField>
                        <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Callback URL</span>
                            <Input
                                value={
                                    selectedOrg.slug && providerSlug
                                        ? `${getAgentaWebUrl()}/auth/callback/sso:${selectedOrg.slug}:${providerSlug}`
                                        : ""
                                }
                                placeholder="Set organization and provider slug"
                                readOnly
                            />
                        </div>
                        <FormField name="issuer_url" label="Issuer URL" required>
                            {(field) => (
                                <Input {...field} placeholder="https://accounts.google.com" />
                            )}
                        </FormField>
                        <FormField name="client_id" label="Client ID" required>
                            {(field) => <Input {...field} placeholder="Your OAuth 2.0 Client ID" />}
                        </FormField>
                        <FormField name="client_secret" label="Client Secret" required>
                            {(field) => (
                                <Input
                                    {...field}
                                    type="password"
                                    placeholder="Your OAuth 2.0 Client Secret"
                                />
                            )}
                        </FormField>
                        <FormField name="scopes" label="Scopes (comma-separated)">
                            {(field) => <Input {...field} placeholder="openid, profile, email" />}
                        </FormField>
                        <p className="text-xs text-muted-foreground">
                            After adding the provider, use the &quot;Test&quot; button to verify the
                            connection.
                        </p>
                    </Form>
                    <DialogFooter>
                        <Button variant="outline" onClick={closeProviderModal}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            form="provider-form"
                            disabled={
                                createProviderMutation.isPending || updateProviderMutation.isPending
                            }
                        >
                            {createProviderMutation.isPending ||
                            updateProviderMutation.isPending ? (
                                <Spinner />
                            ) : null}
                            {editingProvider ? "Update" : "Add"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
        </div>
    )
}

export default Organization
