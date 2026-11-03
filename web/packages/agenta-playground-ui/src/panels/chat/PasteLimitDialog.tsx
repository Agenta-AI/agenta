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

const limitSummary = ({maxPasteChars, overBy}: PasteOverLimit) =>
    overBy > 0
        ? `This paste is ${overBy.toLocaleString()} characters over the ${maxPasteChars.toLocaleString()}-character limit.`
        : `This paste exceeds the ${maxPasteChars.toLocaleString()}-character limit.`

/** Offers to attach a paste that is too long as a snippet file instead of typing it in. */
export const PasteLimitDialog = ({paste, onAttach, onClose}: PasteLimitDialogProps) => {
    const createSnippet = async () => {
        if (!paste) return
        try {
            const {fileData, filename, mimeType} = await createSnippetPdfAttachment(
                paste.pastedText,
            )
            onAttach(fileData, filename, mimeType)
            message.success(`Attached ${filename} as a snippet.`)
        } catch (error) {
            console.error("Failed to create snippet attachment", error)
            message.error("Failed to create snippet attachment.")
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
                    <AlertDialogTitle>That&apos;s too long to paste</AlertDialogTitle>
                    <AlertDialogDescription>
                        {paste
                            ? `${limitSummary(paste)} To keep the editor responsive, you can attach the pasted content as a snippet instead.`
                            : ""}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline">Dismiss</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                        <Button onClick={() => void createSnippet()}>Create Snippet</Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
