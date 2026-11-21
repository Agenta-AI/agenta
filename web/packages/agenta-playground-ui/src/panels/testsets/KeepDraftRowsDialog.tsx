import {useT} from "@agenta/i18n"
import testsetsCatalog from "@agenta/i18n/catalogs/playground.testsets"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

export interface KeepDraftRowsDialogProps {
    draftCount: number
    testsetName: string | null
    /** A chat playground loads one test case, so it can only replace the conversation. */
    chat: boolean
    onKeep: () => void
    onDiscard: () => void
    onCancel: () => void
}

/** Asks what happens to the draft test cases when a test set loads. */
export const KeepDraftRowsDialog = ({
    draftCount,
    testsetName,
    chat,
    onKeep,
    onDiscard,
    onCancel,
}: KeepDraftRowsDialogProps) => {
    const t = useT(testsetsCatalog)
    const name = testsetName?.trim() || t("playground.testsets.theTestSet")
    const many = draftCount > 1
    return (
        <AlertDialog
            open
            onOpenChange={(next) => {
                if (!next) onCancel()
            }}
        >
            <AlertDialogContent className="max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {chat
                            ? t("playground.testsets.replaceConversationTitle")
                            : t("playground.testsets.keepDraftsTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="flex flex-col gap-2">
                            {chat ? (
                                <>
                                    <p className="m-0">
                                        {t("playground.testsets.loadingReplaces", {name})}
                                    </p>
                                    <p className="m-0">{t("playground.testsets.chatOneAtATime")}</p>
                                </>
                            ) : (
                                <>
                                    <p className="m-0">
                                        {many
                                            ? t("playground.testsets.draftsMany", {
                                                  count: draftCount,
                                              })
                                            : t("playground.testsets.draftsOne")}
                                    </p>
                                    <p className="m-0">
                                        {many
                                            ? t("playground.testsets.keepThemAndLoad", {name})
                                            : t("playground.testsets.keepItAndLoad", {name})}
                                    </p>
                                </>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={onCancel}>
                            {t("playground.testsets.cancel")}
                        </Button>
                    </AlertDialogCancel>
                    <Button variant="destructive" onClick={onDiscard}>
                        {chat
                            ? t("playground.testsets.loadAndReplace")
                            : t("playground.testsets.discardDrafts")}
                    </Button>
                    {chat ? null : (
                        <Button onClick={onKeep}>{t("playground.testsets.keepAndLoad")}</Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
