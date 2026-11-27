import {useEffect, useState} from "react"

import {useProfile} from "@agenta/entities/profile"
import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {useMutation, useQueryClient} from "@tanstack/react-query"

import {AddLicenseKeyDialog} from "./AddLicenseKeyDialog"
import {
    activateInstanceLicense,
    isInvalidLicenseKey,
    isOtherInstanceKey,
    REGISTERED_PLAN,
} from "./licenseApi"
import {LicenseSummary} from "./LicenseSummary"
import {RegistrationForm} from "./RegistrationForm"
import {RegistrationGains} from "./RegistrationGains"
import type {SettingsTabProps} from "./settingsTabProps"
import {BillingLoadError} from "./states/BillingLoadError"
import {LicenseAdminOnly} from "./states/LicenseAdminOnly"
import {SettingsTabSkeleton} from "./states/SettingsTabSkeleton"
import {CONTACT_URL, PRICING_URL} from "./upgradePrompt"
import {useActivationLinkKey} from "./useActivationLinkKey"
import {instanceLicenseQueryKey, useInstanceLicense} from "./useInstanceLicense"
import {invalidateLicenseUsage, useLicenseUsage} from "./useLicenseUsage"

const tNow = createT(settingsLicenseCatalog)

const errorMessage = (error: unknown) =>
    isOtherInstanceKey(error)
        ? tNow("settings.license.otherInstanceKey")
        : isInvalidLicenseKey(error)
          ? tNow("settings.license.invalidKey")
          : tNow("settings.license.addFailed")

/**
 * The instance license, for the instance admin: the plan with its usage, then one next step.
 * Without a key, the free registration; with the free key, the Enterprise offer; with a paid
 * key, replace it or talk to us. A license key goes in through a dialog. An activation link
 * (`#key=`) asks to confirm, then adds its key.
 */
export const LicenseTab = ({projectId}: SettingsTabProps) => {
    const t = useT(settingsLicenseCatalog, commonCatalog)
    const queryClient = useQueryClient()
    const license = useInstanceLicense(projectId)
    const limits = useLicenseUsage(projectId)
    const {user} = useProfile()
    const [linkKey, dismissLinkKey] = useActivationLinkKey()
    const [error, setError] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)

    const activate = useMutation({
        mutationFn: (key: string) => activateInstanceLicense(projectId, key),
        onSuccess: (data) => {
            setError(null)
            setDialogOpen(false)
            dismissLinkKey()
            queryClient.setQueryData(instanceLicenseQueryKey(projectId), data)
            void invalidateLicenseUsage(queryClient)
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
    const canAddKey = !fromEnvironment
    const key = license.data.license
    const registered = license.data.plan === REGISTERED_PLAN
    const openDialog = () => {
        setError(null)
        setDialogOpen(true)
    }

    // Where a key would go in: the dialog, or why it cannot go in here.
    const keyControl = (label: "actionAddLicenseKey" | "replaceKey") =>
        canAddKey ? (
            <Button type="button" size="sm" variant="outline" onClick={openDialog}>
                {t(`settings.license.${label}`)}
            </Button>
        ) : null
    const keyNote = fromEnvironment ? (
        <p className="text-muted-foreground m-0 text-[13px]">
            {t("settings.license.fromEnvironment")}
        </p>
    ) : null
    const talkToUs = (
        <Button asChild size="sm" variant="outline">
            <a href={CONTACT_URL} target="_blank" rel="noreferrer">
                {t("settings.license.actionTalkToUs")}
            </a>
        </Button>
    )

    return (
        <div className="flex flex-col gap-5">
            <LicenseSummary license={license.data} limits={limits.data} />

            {!key ? (
                <>
                    <section className="bg-colorInfoBg ring-colorInfoBorder flex flex-col gap-4 rounded-2xl px-5 py-[18px] ring-1 ring-inset">
                        <h3 className="text-foreground m-0 text-sm font-semibold">
                            {t("settings.license.freeKeyTitle")}
                        </h3>
                        <RegistrationGains />
                        <RegistrationForm projectId={projectId} defaultEmail={user?.email} />
                    </section>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-muted-foreground text-[13px]">
                            {t("settings.license.haveKey")}
                        </span>
                        {keyControl("actionAddLicenseKey")}
                        <Button asChild size="sm" variant="ghost">
                            <a href={PRICING_URL} target="_blank" rel="noreferrer">
                                {t("settings.license.seeEnterpriseFeatures")}
                            </a>
                        </Button>
                    </div>
                    {keyNote}
                </>
            ) : registered ? (
                <section className="bg-card ring-border flex flex-col gap-3 rounded-2xl px-5 py-[18px] ring-1 ring-inset">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-foreground m-0 text-sm font-semibold">
                            {t("settings.license.enterpriseUpsellTitle")}
                        </h3>
                        <p className="text-muted-foreground m-0 text-[13px]">
                            {t("settings.license.enterpriseUpsellDescription")}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {talkToUs}
                        {keyControl("actionAddLicenseKey")}
                    </div>
                    {keyNote}
                </section>
            ) : (
                <>
                    <div className="flex flex-wrap gap-2">
                        {keyControl("replaceKey")}
                        {talkToUs}
                    </div>
                    {keyNote}
                </>
            )}

            <AddLicenseKeyDialog
                open={canAddKey && dialogOpen && !linkKey}
                pending={activate.isPending}
                error={error}
                onSubmit={(value) => activate.mutate(value)}
                onClose={() => setDialogOpen(false)}
            />

            <AlertDialog
                open={canAddKey && Boolean(linkKey)}
                onOpenChange={(next) => {
                    if (next || activate.isPending) return
                    setError(null)
                    dismissLinkKey()
                }}
            >
                <AlertDialogContent
                    onEscapeKeyDown={(event) => {
                        if (activate.isPending) event.preventDefault()
                    }}
                >
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("settings.license.confirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("settings.license.confirmDescription")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {linkKey && error ? (
                        <p className="m-0 text-body text-destructive">{error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                disabled={activate.isPending}
                                onClick={() => {
                                    setError(null)
                                    dismissLinkKey()
                                }}
                            >
                                {t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        {/* preventDefault keeps it open: it closes on success and stays for the error. */}
                        <AlertDialogAction asChild>
                            <Button
                                disabled={activate.isPending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    if (linkKey) activate.mutate(linkKey)
                                }}
                            >
                                {t("settings.license.addKey")}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
