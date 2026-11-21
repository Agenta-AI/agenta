import {useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

/**
 * "Remove {name} from this agent?" (F06 f2). Removing an item from the agent keeps what the
 * project holds, and the description says what stays.
 */
export const RemoveFromAgentDialog = ({
    open,
    name,
    description,
    onRemove,
    onClose,
}: {
    open: boolean
    name: string
    /** What stays, for example "The connection stays in the project." */
    description: string
    onRemove: () => void
    onClose: () => void
}) => {
    const t = useT(integrationViewsCatalog)
    return (
        <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <AlertDialogContent data-testid="remove-from-agent-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("entityUi.integrationViews.removeTitle", {name})}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t("entityUi.integrationViews.cancel")}
                    </Button>
                    <Button variant="destructive" onClick={onRemove}>
                        {t("entityUi.integrationViews.remove")}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
