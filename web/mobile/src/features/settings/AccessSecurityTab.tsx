import {useEffect, useState} from "react"

import {
    organizationAccessApi,
    updateOrganization,
    type OrganizationDomain,
    type OrganizationFlags,
    type OrganizationProvider,
} from "@agenta/entities/organization"
import {
    AccessControlsSection,
    type AccessFeature,
    AccessUpgradeNotice,
    type AuthFlagKey,
    DomainsSection,
    SsoProvidersSection,
    useEntitlements,
} from "@agenta/settings-ui"
import {LoadError} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {useQuery} from "@tanstack/react-query"

import {useProjectPermission} from "../context/useProjectPermission"

import {plainAccessError} from "./accessErrors"
import {AddDomainDialog} from "./AddDomainDialog"
import {ConfirmModal} from "./ConfirmModal"
import {DomainDnsInstructions} from "./DomainDnsInstructions"
import {OrganizationSlugField} from "./OrganizationSlugField"
import type {SettingsTabProps} from "./settingsTabProps"
import {useMobileSettingsAccess} from "./settingsTabs"
import {SsoProviderDialog, type SsoProviderFormValues} from "./SsoProviderDialog"
import {OrganizationLoading, OrganizationNoFlags} from "./states/OrganizationStates"
import {useSettingsOrg} from "./useSettingsOrg"

/** Settings > Access & Security: sign-in policy, verified domains and SSO, each gated by plan. */
export const AccessSecurityTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const access = useMobileSettingsAccess()
    const {organizationId, org, loading, failed, retry} = useSettingsOrg(workspaceId)
    const domains = useQuery({
        queryKey: ["organization-domains", organizationId, projectId],
        queryFn: () => organizationAccessApi.fetchOrganizationDomains(projectId),
        enabled: Boolean(organizationId && projectId),
    })
    const providers = useQuery({
        queryKey: ["organization-providers", organizationId, projectId],
        queryFn: () => organizationAccessApi.fetchOrganizationProviders(projectId),
        enabled: Boolean(organizationId && projectId),
    })
    const entitlements = useEntitlements({projectId, enabled: access.isEE})
    const canEdit = useProjectPermission(projectId, "edit_workspace")

    const [savingFlag, setSavingFlag] = useState<AuthFlagKey | null>(null)
    const [lastSavedFlag, setLastSavedFlag] = useState<AuthFlagKey | null>(null)
    const [flagError, setFlagError] = useState<string | null>(null)
    const [addDomainOpen, setAddDomainOpen] = useState(false)
    const [deletingDomain, setDeletingDomain] = useState<OrganizationDomain | null>(null)
    const [domainBusy, setDomainBusy] = useState<"verify" | "refresh" | "delete" | null>(null)
    const [domainError, setDomainError] = useState<string | null>(null)
    const [providerDialog, setProviderDialog] = useState<{
        provider: OrganizationProvider | null
    } | null>(null)
    const [deletingProvider, setDeletingProvider] = useState<OrganizationProvider | null>(null)
    const [providerBusy, setProviderBusy] = useState<"enable" | "delete" | null>(null)
    const [providerError, setProviderError] = useState<string | null>(null)
    const [providerNotice, setProviderNotice] = useState<string | null>(null)
    // The saved tick is a confirmation, so it clears itself.
    useEffect(() => {
        if (!lastSavedFlag) return
        const timer = setTimeout(() => setLastSavedFlag(null), 3_000)
        return () => clearTimeout(timer)
    }, [lastSavedFlag])

    const setFlag = async (flag: AuthFlagKey, value: boolean) => {
        if (!organizationId) return
        setSavingFlag(flag)
        setFlagError(null)
        setLastSavedFlag(null)
        try {
            await updateOrganization(organizationId, {flags: {[flag]: value}})
            await org.refetch()
            setLastSavedFlag(flag)
        } catch (error) {
            setFlagError(plainAccessError(error, "Couldn't save that setting — try again"))
        } finally {
            setSavingFlag(null)
        }
    }

    const verifyDomain = async (domain: OrganizationDomain) => {
        setDomainBusy("verify")
        setDomainError(null)
        try {
            await organizationAccessApi.verifyOrganizationDomain(projectId, domain.id)
            await domains.refetch()
        } catch (error) {
            setDomainError(plainAccessError(error, "Could not verify the domain"))
        } finally {
            setDomainBusy(null)
        }
    }

    const refreshDomainToken = async (domain: OrganizationDomain) => {
        setDomainBusy("refresh")
        setDomainError(null)
        try {
            await organizationAccessApi.refreshOrganizationDomainToken(projectId, domain.id)
            await domains.refetch()
        } catch (error) {
            setDomainError(plainAccessError(error, "Could not refresh the token"))
        } finally {
            setDomainBusy(null)
        }
    }

    const deleteDomain = async () => {
        if (!deletingDomain) return
        setDomainBusy("delete")
        setDomainError(null)
        try {
            await organizationAccessApi.deleteOrganizationDomain(projectId, deletingDomain.id)
            await domains.refetch()
            setDeletingDomain(null)
        } catch (error) {
            setDomainError(plainAccessError(error, "Could not delete the domain"))
        } finally {
            setDomainBusy(null)
        }
    }

    const saveProvider = async (values: SsoProviderFormValues) => {
        setProviderError(null)
        setProviderNotice(null)
        if (providerDialog?.provider) {
            await organizationAccessApi.updateOrganizationProvider(
                projectId,
                providerDialog.provider.id,
                values,
            )
            setProviderNotice(
                "Provider saved. Editing settings clears validation, so enable it again.",
            )
        } else {
            if (!values.slug) return
            await organizationAccessApi.createOrganizationProvider(projectId, {
                ...values,
                slug: values.slug,
            })
            setProviderNotice("Provider added. Enable it to verify and activate it.")
        }
        await providers.refetch()
    }

    const enableProvider = async (provider: OrganizationProvider) => {
        setProviderBusy("enable")
        setProviderError(null)
        setProviderNotice(null)
        try {
            if (provider.flags?.is_valid) {
                await organizationAccessApi.updateOrganizationProvider(projectId, provider.id, {
                    flags: {is_active: true},
                })
            } else {
                const tested = await organizationAccessApi.testOrganizationProvider(
                    projectId,
                    provider.id,
                )
                if (!tested?.flags?.is_valid) {
                    setProviderError(
                        "We could not connect to the provider. Check the issuer URL and client details, then try again.",
                    )
                }
            }
            await providers.refetch()
        } catch (error) {
            setProviderError(plainAccessError(error, "Could not enable the provider"))
        } finally {
            setProviderBusy(null)
        }
    }

    const deleteProvider = async () => {
        if (!deletingProvider) return
        setProviderBusy("delete")
        setProviderError(null)
        try {
            await organizationAccessApi.deleteOrganizationProvider(projectId, deletingProvider.id)
            await providers.refetch()
            setDeletingProvider(null)
        } catch (error) {
            setProviderError(plainAccessError(error, "Could not delete the provider"))
        } finally {
            setProviderBusy(null)
        }
    }

    // Entitlements gate every section; rendering before they land flashes the locked state.
    if (loading || entitlements.isLoading) return <OrganizationLoading />
    if (failed)
        return <LoadError title="Could not load this organization's settings" onRetry={retry} />
    const flags = org.data?.flags as OrganizationFlags | undefined
    if (!flags) return <OrganizationNoFlags />

    const domainList = domains.data ?? []
    const providerList = providers.data ?? []
    const orgSlug = org.data?.slug
    const locked = [
        !entitlements.hasAccessControl && "access",
        !entitlements.hasDomains && "domains",
        !entitlements.hasSSO && "sso",
    ].filter(Boolean) as AccessFeature[]

    return (
        <div className="flex flex-col gap-8">
            {entitlements.hasAccessControl ? (
                <AccessControlsSection
                    flags={flags}
                    onFlagChange={(flag, value) => void setFlag(flag, value)}
                    updating={Boolean(savingFlag)}
                    lastSavedFlag={lastSavedFlag}
                    error={flagError}
                    hasActiveVerifiedProvider={providerList.some(
                        (provider) => provider.flags?.is_active && provider.flags?.is_valid,
                    )}
                    hasVerifiedDomain={domainList.some((domain) => domain.flags?.is_verified)}
                />
            ) : null}

            {entitlements.hasDomains ? (
                <div className="flex flex-col gap-2">
                    {domainError ? (
                        <p role="alert" className="text-destructive m-0 text-xs">
                            {domainError}
                        </p>
                    ) : null}
                    <DomainsSection
                        domains={domainList}
                        loading={domains.isPending}
                        onAdd={canEdit ? () => setAddDomainOpen(true) : undefined}
                        onVerify={canEdit ? (domain) => void verifyDomain(domain) : undefined}
                        onRefreshToken={
                            canEdit ? (domain) => void refreshDomainToken(domain) : undefined
                        }
                        onDelete={
                            canEdit
                                ? (domain) => {
                                      setDomainError(null)
                                      setDeletingDomain(domain)
                                  }
                                : undefined
                        }
                        verifying={domainBusy === "verify"}
                        refreshing={domainBusy === "refresh"}
                        deleting={domainBusy === "delete"}
                        renderInstructions={
                            canEdit
                                ? (domain) => <DomainDnsInstructions domain={domain} />
                                : undefined
                        }
                    />
                </div>
            ) : null}

            {entitlements.hasSSO ? (
                <div className="flex flex-col gap-2">
                    {providerError ? (
                        <p role="alert" className="text-destructive m-0 text-xs">
                            {providerError}
                        </p>
                    ) : null}
                    {providerNotice ? (
                        <p role="status" className="m-0 text-xs text-muted-foreground">
                            {providerNotice}
                        </p>
                    ) : null}
                    <SsoProvidersSection
                        providers={providerList}
                        loading={providers.isPending}
                        callbackUrlFor={(provider: OrganizationProvider) =>
                            orgSlug
                                ? `${window.location.origin}/auth/callback/sso:${orgSlug}:${provider.slug}`
                                : null
                        }
                        onAdd={
                            canEdit && orgSlug
                                ? () => {
                                      setProviderError(null)
                                      setProviderNotice(null)
                                      setProviderDialog({provider: null})
                                  }
                                : undefined
                        }
                        addLabel={orgSlug ? "Add provider" : "Add provider (set slug first)"}
                        onEdit={
                            canEdit
                                ? (provider) => {
                                      setProviderError(null)
                                      setProviderNotice(null)
                                      setProviderDialog({provider})
                                  }
                                : undefined
                        }
                        onEnable={canEdit ? (provider) => void enableProvider(provider) : undefined}
                        onDelete={
                            canEdit
                                ? (provider) => {
                                      setProviderError(null)
                                      setDeletingProvider(provider)
                                  }
                                : undefined
                        }
                        enabling={providerBusy === "enable"}
                        deleting={providerBusy === "delete"}
                    >
                        <OrganizationSlugField
                            organizationId={organizationId!}
                            slug={orgSlug}
                            canEdit={canEdit}
                            onSaved={async () => {
                                await org.refetch()
                                await providers.refetch()
                            }}
                        />
                        {!orgSlug ? (
                            <div className="mt-2 flex flex-col gap-2">
                                {canEdit ? (
                                    <div>
                                        <Button disabled title="Set an organization slug first">
                                            Add provider
                                        </Button>
                                    </div>
                                ) : null}
                                <p className="m-0 text-xs text-muted-foreground">
                                    Set an organization slug before adding a provider. The callback
                                    URL cannot be formed without it.
                                </p>
                            </div>
                        ) : null}
                    </SsoProvidersSection>
                </div>
            ) : null}

            <AccessUpgradeNotice locked={locked} />

            <AddDomainDialog
                open={addDomainOpen}
                onClose={() => setAddDomainOpen(false)}
                onSubmit={async (domain) => {
                    await organizationAccessApi.createOrganizationDomain(projectId, {domain})
                    await domains.refetch()
                }}
            />

            <ConfirmModal
                open={Boolean(deletingDomain)}
                title="Delete domain"
                description="This cannot be undone."
                body={`Removes ${deletingDomain?.slug ?? "this domain"} from this organization.`}
                confirmLabel="Delete domain"
                pending={domainBusy === "delete"}
                error={deletingDomain ? domainError : null}
                onClose={() => {
                    setDeletingDomain(null)
                    setDomainError(null)
                }}
                onConfirm={() => void deleteDomain()}
            />

            <SsoProviderDialog
                open={Boolean(providerDialog)}
                provider={providerDialog?.provider ?? null}
                onClose={() => setProviderDialog(null)}
                onSubmit={saveProvider}
            />

            <ConfirmModal
                open={Boolean(deletingProvider)}
                title="Delete SSO provider"
                description="This cannot be undone."
                body={`Removes ${deletingProvider?.slug ?? "this provider"} and its stored secret.`}
                confirmLabel="Delete provider"
                pending={providerBusy === "delete"}
                error={deletingProvider ? providerError : null}
                onClose={() => {
                    setDeletingProvider(null)
                    setProviderError(null)
                }}
                onConfirm={() => void deleteProvider()}
            />
        </div>
    )
}
