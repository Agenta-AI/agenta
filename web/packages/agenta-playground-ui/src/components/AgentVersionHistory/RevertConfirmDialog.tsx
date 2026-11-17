import {useT} from "@agenta/i18n"
import versionCatalog from "@agenta/i18n/catalogs/playground.versionHistory"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

export interface RevertConfirmDialogProps {
    open: boolean
    /** The drawer panel: the dialog masks and centres inside it, not the page. */
    container: HTMLElement | null
    selectedVersion: number | null
    latestVersion: number | null
    onCancel: () => void
    onConfirm: () => void
}

/** The revert confirmation, scoped to the version history drawer. */
export const RevertConfirmDialog = ({
    open,
    container,
    selectedVersion,
    latestVersion,
    onCancel,
    onConfirm,
}: RevertConfirmDialogProps) => {
    const t = useT(versionCatalog)
    return (
        // Non-modal: the drawer already traps focus; a second modal layer would fight it.
        <Dialog modal={false} open={open} onOpenChange={(next) => !next && onCancel()}>
            <DialogContent
                container={container}
                contained
                showCloseButton={false}
                className="max-w-[400px]"
            >
                <DialogHeader>
                    <DialogTitle>
                        {t("playground.versionHistory.revertTitle", {
                            version: selectedVersion ?? "",
                        })}
                    </DialogTitle>
                    <DialogDescription>
                        {t("playground.versionHistory.revertDescription", {
                            next: (latestVersion ?? 0) + 1,
                            version: selectedVersion ?? "",
                            latest: latestVersion ?? "",
                        })}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        {t("playground.versionHistory.cancel")}
                    </Button>
                    <Button onClick={onConfirm}>{t("playground.versionHistory.revert")}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
