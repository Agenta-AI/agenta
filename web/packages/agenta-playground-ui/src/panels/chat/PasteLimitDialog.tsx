import {createT, formatNumber, useT} from "@agenta/i18n"
import chatCatalog from "@agenta/i18n/catalogs/playground.chat"
import {message} from "@agenta/ui/app-message"
import {createSnippetPdfAttachment} from "@agenta/ui/chat-message"
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

/** A paste that went over the editor limit, and the text that was pasted. */
export interface PasteOverLimit {
    pastedText: string
    maxPasteChars: number
    overBy: number
}

export interface PasteLimitDialogProps {
    /** The paste to ask about; the dialog is open while this is set. */
    paste: PasteOverLimit | null
    /** Adds the snippet file to the message. */
    onAttach: (fileData: string, filename: string, mimeType: string) => void
    onClose: () => void
}

const tNow = createT(chatCatalog)

const limitSummary = ({maxPasteChars, overBy}: PasteOverLimit) =>
    overBy > 0
        ? tNow("playground.chat.pasteOverBy", {
              over: formatNumber(overBy),
              max: formatNumber(maxPasteChars),
          })
        : tNow("playground.chat.pasteExceeds", {max: formatNumber(maxPasteChars)})

/** Offers to attach a paste that is too long as a snippet file instead of typing it in. */
export const PasteLimitDialog = ({paste, onAttach, onClose}: PasteLimitDialogProps) => {
    const t = useT(chatCatalog)
    const createSnippet = async () => {
        if (!paste) return
        try {
            const {fileData, filename, mimeType} = await createSnippetPdfAttachment(
                paste.pastedText,
            )
            onAttach(fileData, filename, mimeType)
            message.success(t("playground.chat.attachedSnippet", {filename}))
        } catch (error) {
            console.error("Failed to create snippet attachment", error)
            message.error(t("playground.chat.snippetFailed"))
        }
    }

    return (
        <AlertDialog
            open={paste !== null}
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("playground.chat.tooLong")}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {paste
                            ? t("playground.chat.pasteAdvice", {summary: limitSummary(paste)})
                            : ""}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline">{t("playground.chat.dismiss")}</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                        <Button onClick={() => void createSnippet()}>
                            {t("playground.chat.createSnippet")}
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
