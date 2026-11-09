import {useEffect, useState} from "react"

import {isEE} from "@agenta/shared/api"
import {useMutation, useQueryClient} from "@tanstack/react-query"

import {ConfirmModal} from "./ConfirmModal"
import {activateInstanceLicense, isInvalidLicenseKey} from "./licenseApi"
import {LicenseKeyForm} from "./LicenseKeyForm"
import {LicenseSummary} from "./LicenseSummary"
import type {SettingsTabProps} from "./settingsTabProps"
import {BillingLoadError} from "./states/BillingLoadError"
import {LicenseAdminOnly} from "./states/LicenseAdminOnly"
import {SettingsTabSkeleton} from "./states/SettingsTabSkeleton"
import {useActivationLinkKey} from "./useActivationLinkKey"
import {instanceLicenseQueryKey, useInstanceLicense} from "./useInstanceLicense"

const UPGRADE_DOCS_URL = "https://docs.agenta.ai/self-host/upgrades/oss-to-ee-switch"

const errorMessage = (error: unknown) =>
    isInvalidLicenseKey(error)
        ? "This license key is not valid"
        : "We could not add the key. Try again."

/**
 * The instance license, for the instance admin: the plan, the key behind it, and a field to add
 * a key. An activation link (`#key=`) asks to confirm, then adds its key. On the OSS image the key
 * check is not there, so the page points to the Enterprise image instead of the field.
 */
export const LicenseTab = ({projectId}: SettingsTabProps) => {
    const queryClient = useQueryClient()
    const license = useInstanceLicense(projectId)
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
    const cannotAddKey =
        license.notInstanceAdmin ||
        (license.data && (!isEE() || license.data.source === "environment"))
    useEffect(() => {
        if (linkKey && cannotAddKey) dismissLinkKey()
    }, [linkKey, cannotAddKey, dismissLinkKey])

    if (license.notInstanceAdmin) return <LicenseAdminOnly />
    if (license.isError)
        return (
            <BillingLoadError
                message="We could not load the license."
                onRetry={() => void license.refetch()}
            />
        )
    if (!license.data) return <SettingsTabSkeleton />

    const enterprise = isEE()
    const fromEnvironment = license.data.source === "environment"
    const canAddKey = enterprise && !fromEnvironment

    return (
        <div className="flex flex-col gap-5">
            <LicenseSummary license={license.data} />

            {!enterprise ? (
                <p className="text-muted-foreground m-0 text-[13px]">
                    License keys need the Enterprise image.{" "}
                    <a
                        href={UPGRADE_DOCS_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground underline"
                    >
                        How to upgrade
                    </a>
                </p>
            ) : fromEnvironment ? (
                <p className="text-muted-foreground m-0 text-[13px]">
                    This key is set in the server settings and cannot be changed here.
                </p>
            ) : (
                <LicenseKeyForm
                    pending={activate.isPending && !linkKey}
                    error={linkKey ? null : error}
                    onSubmit={(key) => activate.mutate(key)}
                />
            )}

            <ConfirmModal
                open={canAddKey && Boolean(linkKey)}
                title="Add this license key?"
                description="The key from your link changes the plan of every organization on this instance."
                confirmLabel="Add key"
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
