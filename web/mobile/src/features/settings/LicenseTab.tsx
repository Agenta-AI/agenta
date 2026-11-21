import {useEffect, useState} from "react"

import {useProfile} from "@agenta/entities/profile"
import {createT, useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {useMutation, useQueryClient} from "@tanstack/react-query"

import {ConfirmModal} from "./ConfirmModal"
import {activateInstanceLicense, isInvalidLicenseKey} from "./licenseApi"
import {LicenseKeyForm} from "./LicenseKeyForm"
import {LicenseSummary} from "./LicenseSummary"
import {RegistrationForm} from "./RegistrationForm"
import type {SettingsTabProps} from "./settingsTabProps"
import {BillingLoadError} from "./states/BillingLoadError"
import {LicenseAdminOnly} from "./states/LicenseAdminOnly"
import {SettingsTabSkeleton} from "./states/SettingsTabSkeleton"
import {useActivationLinkKey} from "./useActivationLinkKey"
import {instanceLicenseQueryKey, useInstanceLicense} from "./useInstanceLicense"

const tNow = createT(settingsLicenseCatalog)

const errorMessage = (error: unknown) =>
    isInvalidLicenseKey(error)
        ? tNow("settings.license.invalidKey")
        : tNow("settings.license.addFailed")

/**
 * The instance license, for the instance admin: the plan, the key behind it, and a field to add
 * a key. An activation link (`#key=`) asks to confirm, then adds its key.
 */
export const LicenseTab = ({projectId}: SettingsTabProps) => {
    const t = useT(settingsLicenseCatalog)
    const queryClient = useQueryClient()
    const license = useInstanceLicense(projectId)
    const {user} = useProfile()
    const [linkKey, dismissLinkKey] = useActivationLinkKey()
    const [error, setError] = useState<string | null>(null)

    const activate = useMutation({
        mutationFn: (key: string) => activateInstanceLicense(projectId, key),
        onSuccess: (data) => {
            setError(null)
            dismissLinkKey()
            queryClient.setQueryData(instanceLicenseQueryKey(projectId), data)
            // The plan changes every organization's features at once.
            void queryClient.invalidateQueries({queryKey: ["billing"]})
            void queryClient.invalidateQueries({queryKey: ["access"]})
        },
        onError: (cause) => setError(errorMessage(cause)),
    })

    // A reader who cannot add the key: drop it, so the `/m` root stops sending them here.
    const cannotAddKey = license.notInstanceAdmin || license.data?.source === "environment"
    useEffect(() => {
        if (linkKey && cannotAddKey) dismissLinkKey()
    }, [linkKey, cannotAddKey, dismissLinkKey])

    if (license.notInstanceAdmin) return <LicenseAdminOnly />
    if (license.isError)
        return (
            <BillingLoadError
                message={t("settings.license.loadFailed")}
                onRetry={() => void license.refetch()}
            />
        )
    if (!license.data) return <SettingsTabSkeleton />

    const fromEnvironment = license.data.source === "environment"

    return (
        <div className="flex flex-col gap-5">
            <LicenseSummary license={license.data} />

            {!license.data.license ? (
                <section className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-foreground m-0 text-sm font-medium">
                            {t("settings.license.freeKeyTitle")}
                        </h3>
                        <p className="text-muted-foreground m-0 text-[13px]">
                            {t("settings.license.freeKeyDescription")}
                        </p>
                    </div>
                    <RegistrationForm projectId={projectId} defaultEmail={user?.email} />
                </section>
            ) : null}

            {fromEnvironment ? (
                <p className="text-muted-foreground m-0 text-[13px]">
                    {t("settings.license.fromEnvironment")}
                </p>
            ) : (
                <LicenseKeyForm
                    pending={activate.isPending && !linkKey}
                    error={linkKey ? null : error}
                    onSubmit={(key) => activate.mutate(key)}
                />
            )}

            <ConfirmModal
                open={!fromEnvironment && Boolean(linkKey)}
                title={t("settings.license.confirmTitle")}
                description={t("settings.license.confirmDescription")}
                confirmLabel={t("settings.license.addKey")}
                destructive={false}
                pending={activate.isPending}
                error={linkKey ? error : null}
                onConfirm={() => linkKey && activate.mutate(linkKey)}
                onClose={() => {
                    setError(null)
                    dismissLinkKey()
                }}
            />
        </div>
    )
}
