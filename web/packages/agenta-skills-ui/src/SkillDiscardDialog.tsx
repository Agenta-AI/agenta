import {useT} from "@agenta/i18n"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

/** Asks before a step back drops a skill that is not created yet. */
export function SkillDiscardDialog({
    open,
    onKeep,
    onDiscard,
}: {
    open: boolean
    onKeep: () => void
    onDiscard: () => void
}) {
    const t = useT(skillsPageCatalog)
    return (
        <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onKeep())}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("skills.page.discardTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("skills.page.discardNewBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="ghost" onClick={onKeep}>
                        {t("skills.page.keepEditing")}
                    </Button>
                    <Button variant="destructive" onClick={onDiscard}>
                        {t("skills.page.discard")}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
