import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"
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

/**
 * The warning before the panel, the drawer or the test case changes while the test case part
 * has changes not saved to the test set. Nothing moves until the user picks.
 */
export const ScenarioFocusAnnotateUnsaved = ({
    open,
    onDiscard,
    onKeep,
}: {
    open: boolean
    onDiscard: () => void
    onKeep: () => void
}) => {
    const t = useT(annotateCatalog)
    return (
        <AlertDialog open={open} onOpenChange={(next) => !next && onKeep()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("evaluations.scenarioFocusAnnotate.unsavedTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("evaluations.scenarioFocusAnnotate.unsavedBody")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction asChild>
                        <Button variant="ghost" className="text-destructive" onClick={onDiscard}>
                            {t("evaluations.scenarioFocusAnnotate.discardChanges")}
                        </Button>
                    </AlertDialogAction>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={onKeep}>
                            {t("evaluations.scenarioFocusAnnotate.keepEditing")}
                        </Button>
                    </AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
