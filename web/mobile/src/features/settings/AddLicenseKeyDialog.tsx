import {useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@agenta/ui/ui"

import {LicenseKeyForm} from "./LicenseKeyForm"

/** Paste a license key in a dialog, so the License tab leads with the plan and the free key. */
export const AddLicenseKeyDialog = ({
    open,
    pending,
    error,
    onSubmit,
    onClose,
}: {
    open: boolean
    pending: boolean
    error: string | null
    onSubmit: (key: string) => void
    onClose: () => void
}) => {
    const t = useT(settingsLicenseCatalog)
    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                    <DialogTitle>{t("settings.license.actionAddLicenseKey")}</DialogTitle>
                </DialogHeader>
                <LicenseKeyForm pending={pending} error={error} onSubmit={onSubmit} />
            </DialogContent>
        </Dialog>
    )
}
