import {useState, type ReactNode} from "react"

import {richText, useT} from "@agenta/i18n"
import toolConnectionsCatalog from "@agenta/i18n/catalogs/entityUi.toolConnections"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    LoadingButton,
} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"

/** A pending connection was never completed; this finishes its sign-in or deletes it. */
export const FinishConnectionDialog = ({
    open,
    name,
    logo,
    apiKey = false,
    onAuthorize,
    onDelete,
    onClose,
    container = null,
}: {
    open: boolean
    /** The app's display name. */
    name: ReactNode
    logo: ReactNode
    /** An API-key connection: no sign-in to reopen, so it can only be deleted and reconnected. */
    apiKey?: boolean
    /** Starts the provider's sign-in; resolves once its window is open. */
    onAuthorize: () => Promise<void>
    onDelete?: () => void
    onClose: () => void
    /** A drawer panel to open inside, masking only that drawer. Absent = the page. */
    container?: HTMLElement | null
}) => {
    const t = useT(toolConnectionsCatalog)
    const [authorizing, setAuthorizing] = useState(false)

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => (next ? undefined : onClose())}
            // Contained runs non-modal: the host drawer already traps focus.
            modal={!container}
        >
            <DialogContent
                className="sm:max-w-[440px]"
                container={container ?? undefined}
                contained={!!container}
            >
                <DialogHeader className="gap-3 text-left">
                    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-border bg-background shadow-xs [&_img]:size-[18px] [&_img]:object-contain">
                        {logo}
                    </span>
                    <div className="flex flex-col gap-1">
                        <DialogTitle className="text-base font-medium leading-snug">
                            {/* The name is a node, so it fills the tag rather than a placeholder. */}
                            {richText(t("entityUi.toolConnections.finishConnecting"), {
                                name: () => name,
                            })}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-colorTextDescription">
                            {apiKey
                                ? t("entityUi.toolConnections.apiKeyNeverVerified")
                                : t("entityUi.toolConnections.signInNeverCompleted")}
                        </DialogDescription>
                    </div>
                </DialogHeader>

                <DialogFooter>
                    {onDelete ? (
                        <Button
                            variant="ghost"
                            // Full width in the stacked phone footer; pushed left above sm.
                            className="w-full text-destructive hover:text-destructive sm:mr-auto sm:w-auto"
                            onClick={() => {
                                onClose()
                                onDelete()
                            }}
                        >
                            {t("entityUi.toolConnections.delete")}
                        </Button>
                    ) : null}
                    <Button variant="outline" onClick={onClose}>
                        {t("entityUi.toolConnections.cancel")}
                    </Button>
                    {apiKey ? null : (
                        <LoadingButton
                            loading={authorizing}
                            onClick={async () => {
                                setAuthorizing(true)
                                try {
                                    await onAuthorize()
                                    onClose()
                                } finally {
                                    setAuthorizing(false)
                                }
                            }}
                        >
                            {t("entityUi.toolConnections.authorize")}
                            <ArrowSquareOut size={14} />
                        </LoadingButton>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
