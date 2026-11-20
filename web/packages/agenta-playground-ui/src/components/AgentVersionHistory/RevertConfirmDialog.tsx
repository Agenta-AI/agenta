import {useT} from "@agenta/i18n"
import versionCatalog from "@agenta/i18n/catalogs/playground.versionHistory"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

export interface RevertConfirmDialogProps {
    open: boolean
    selectedVersion: number | null
    latestVersion: number | null
    onCancel: () => void
    onConfirm: () => void
}

/** The revert confirmation: the app's confirmation dialog, centred on the window (canvas F06 f5). */
export const RevertConfirmDialog = ({
    open,
    selectedVersion,
    latestVersion,
    onCancel,
    onConfirm,
}: RevertConfirmDialogProps) => {
    const t = useT(versionCatalog)
    return (
        <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("playground.versionHistory.revertTitle", {
                            version: selectedVersion ?? "",
                        })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("playground.versionHistory.revertDescription", {
                            next: (latestVersion ?? 0) + 1,
                            version: selectedVersion ?? "",
                            latest: latestVersion ?? "",
                        })}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        {t("playground.versionHistory.cancel")}
                    </Button>
                    <Button onClick={onConfirm}>{t("playground.versionHistory.revert")}</Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
