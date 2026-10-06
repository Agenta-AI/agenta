import {useEffect, useState} from "react"

import {
    fetchOrganizationDomains,
    fetchOrganizationProviders,
    updateOrganization,
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
import {useQuery} from "@tanstack/react-query"

import type {SettingsTabProps} from "./settingsTabProps"
import {useMobileSettingsAccess} from "./settingsTabs"
import {OrganizationLoading, OrganizationNoFlags} from "./states/OrganizationStates"
import {useSettingsOrg} from "./useSettingsOrg"

/** Settings > Access & Security: sign-in policy, verified domains and SSO, each gated by plan. */
export const AccessSecurityTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const access = useMobileSettingsAccess()
    const {organizationId, org} = useSettingsOrg(workspaceId)
    const domains = useQuery({
        queryKey: ["organization-domains", organizationId],
        queryFn: () => fetchOrganizationDomains(),
        enabled: Boolean(organizationId),
    })
    const providers = useQuery({
        queryKey: ["organization-providers", organizationId],
        queryFn: () => fetchOrganizationProviders(),
        enabled: Boolean(organizationId),
    })
    const entitlements = useEntitlements({projectId, enabled: access.isEE})

    const [savingFlag, setSavingFlag] = useState<AuthFlagKey | null>(null)
    const [lastSavedFlag, setLastSavedFlag] = useState<AuthFlagKey | null>(null)
    const [flagError, setFlagError] = useState<string | null>(null)
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
            setFlagError(
                error instanceof Error ? error.message : "Couldn't save that setting — try again",
            )
        } finally {
            setSavingFlag(null)
        }
    }

    // Entitlements gate every section; rendering before they land flashes the locked state.
    if (org.isPending || entitlements.isLoading) return <OrganizationLoading />
    if (org.isError)
        return (
            <LoadError
                title="Could not load this organization's settings"
                onRetry={() => void org.refetch()}
            />
        )
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
                <DomainsSection domains={domainList} loading={domains.isPending} />
            ) : null}

            {entitlements.hasSSO ? (
                <SsoProvidersSection
                    providers={providerList}
                    loading={providers.isPending}
                    callbackUrlFor={(provider: OrganizationProvider) =>
                        orgSlug
                            ? `${window.location.origin}/auth/callback/sso:${orgSlug}:${provider.slug}`
                            : null
                    }
                />
            ) : null}

            <AccessUpgradeNotice locked={locked} />
        </div>
    )
}
