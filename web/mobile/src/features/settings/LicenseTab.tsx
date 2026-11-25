import {useEffect, useState} from "react"

import {useProfile} from "@agenta/entities/profile"
import {createT, richText, useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {isEE} from "@agenta/shared/api"
import {Button} from "@agenta/ui/ui"
import {useMutation, useQueryClient} from "@tanstack/react-query"

import {AddLicenseKeyDialog} from "./AddLicenseKeyDialog"
import {ConfirmModal} from "./ConfirmModal"
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
import {CONTACT_URL, PRICING_URL, UPGRADE_DOCS_URL} from "./upgradePrompt"
import {useActivationLinkKey} from "./useActivationLinkKey"
import {instanceLicenseQueryKey, useInstanceLicense} from "./useInstanceLicense"

const tNow = createT(settingsLicenseCatalog)

const errorMessage = (error: unknown) =>
    isOtherInstanceKey(error)
        ? tNow("settings.license.otherInstanceKey")
        : isInvalidLicenseKey(error)
          ? tNow("settings.license.invalidKey")
          : tNow("settings.license.addFailed")

const externalLink = (href: string) => (text: string) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-foreground underline">
        {text}
    </a>
)

/**
 * The instance license, for the instance admin: the plan with its usage, then one next step.
 * Without a key, the free registration; with the free key, the Enterprise offer; with a paid
 * key, replace it or talk to us. A license key goes in through a dialog. An activation link
 * (`#key=`) asks to confirm, then adds its key. On the OSS image the key check is not there,
 * so the page points to the Enterprise image instead of the dialog.
 */
export const LicenseTab = ({projectId}: SettingsTabProps) => {
    const t = useT(settingsLicenseCatalog)
    const queryClient = useQueryClient()
    const license = useInstanceLicense(projectId)
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
                message={t("settings.license.loadFailed")}
                onRetry={() => void license.refetch()}
            />
        )
    if (!license.data) return <SettingsTabSkeleton />

    const enterprise = isEE()
    const fromEnvironment = license.data.source === "environment"
    const canAddKey = enterprise && !fromEnvironment
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
    const keyNote = !enterprise ? (
        <p className="text-muted-foreground m-0 text-[13px]">
            {richText(t("settings.license.needsEnterpriseImage"), {
                link: externalLink(UPGRADE_DOCS_URL),
            })}
        </p>
    ) : fromEnvironment ? (
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
            <LicenseSummary license={license.data} />

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

            <ConfirmModal
                open={canAddKey && Boolean(linkKey)}
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
