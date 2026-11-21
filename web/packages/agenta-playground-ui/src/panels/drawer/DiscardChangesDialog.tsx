import {useT} from "@agenta/i18n"
import panelsCatalog from "@agenta/i18n/catalogs/playground.panels"
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

/** Asks before the drawer closes or shows another revision while it has unsaved edits. */
export const DiscardChangesDialog = ({
    open,
    onDiscard,
    onCancel,
}: {
    open: boolean
    onDiscard: () => void
    onCancel: () => void
}) => {
    const t = useT(panelsCatalog)
    return (
        <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("playground.panels.discardTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("playground.panels.discardBody")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline">{t("playground.panels.keepEditing")}</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                        <Button variant="destructive" onClick={onDiscard}>
                            {t("playground.panels.discard")}
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
