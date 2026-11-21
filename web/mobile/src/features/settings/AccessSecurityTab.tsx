import {useEffect, useState} from "react"

import {
    organizationAccessApi,
    updateOrganization,
    type OrganizationDomain,
    type OrganizationFlags,
    type OrganizationProvider,
} from "@agenta/entities/organization"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsAccessSecurityTabCatalog from "@agenta/i18n/catalogs/settings.accessSecurityTab"
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
    const t = useT(commonCatalog, settingsAccessSecurityTabCatalog)
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
            setFlagError(plainAccessError(error, t("settings.accessSecurityTab.saveFlagError")))
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
            setDomainError(
                plainAccessError(error, t("settings.accessSecurityTab.verifyDomainError")),
            )
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
            setDomainError(
                plainAccessError(error, t("settings.accessSecurityTab.refreshTokenError")),
            )
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
            setDomainError(
                plainAccessError(error, t("settings.accessSecurityTab.deleteDomainError")),
            )
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
            setProviderNotice(t("settings.accessSecurityTab.providerSavedNotice"))
        } else {
            if (!values.slug) return
            await organizationAccessApi.createOrganizationProvider(projectId, {
                ...values,
                slug: values.slug,
            })
            setProviderNotice(t("settings.accessSecurityTab.providerAddedNotice"))
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
                    setProviderError(t("settings.accessSecurityTab.providerConnectError"))
                }
            }
            await providers.refetch()
        } catch (error) {
            setProviderError(
                plainAccessError(error, t("settings.accessSecurityTab.enableProviderError")),
            )
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
            setProviderError(
                plainAccessError(error, t("settings.accessSecurityTab.deleteProviderError")),
            )
        } finally {
            setProviderBusy(null)
        }
    }

    // Entitlements gate every section; rendering before they land flashes the locked state.
    if (loading || entitlements.isLoading) return <OrganizationLoading />
    if (failed)
        return <LoadError title={t("settings.accessSecurityTab.loadError")} onRetry={retry} />
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
                        addLabel={
                            orgSlug
                                ? t("settings.accessSecurityTab.addProvider")
                                : t("settings.accessSecurityTab.addProviderSetSlug")
                        }
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
                                        <Button
                                            disabled
                                            title={t("settings.accessSecurityTab.setSlugFirst")}
                                        >
                                            {t("settings.accessSecurityTab.addProvider")}
                                        </Button>
                                    </div>
                                ) : null}
                                <p className="m-0 text-xs text-muted-foreground">
                                    {t("settings.accessSecurityTab.setSlugHint")}
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
                title={t("settings.accessSecurityTab.deleteDomain")}
                description={t("common.thisCannotBeUndone")}
                body={t("settings.accessSecurityTab.deleteDomainBody", {
                    name: deletingDomain?.slug ?? t("settings.accessSecurityTab.thisDomain"),
                })}
                confirmLabel={t("settings.accessSecurityTab.deleteDomain")}
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
                title={t("settings.accessSecurityTab.deleteProviderTitle")}
                description={t("common.thisCannotBeUndone")}
                body={t("settings.accessSecurityTab.deleteProviderBody", {
                    name: deletingProvider?.slug ?? t("settings.accessSecurityTab.thisProvider"),
                })}
                confirmLabel={t("settings.accessSecurityTab.deleteProvider")}
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
