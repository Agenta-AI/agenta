import {useState} from "react"

import {useT} from "@agenta/i18n"
import refineCatalog from "@agenta/i18n/catalogs/playground.refine"
import {Button, Dialog, DialogContent, DialogTitle, Segmented, Switch} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"
import clsx from "clsx"

import {RefineInstructions} from "./RefineInstructions"
import {RefinePreview} from "./RefinePreview"
import {useRefinePrompt} from "./useRefinePrompt"

type Pane = "instructions" | "preview"

export interface RefinePromptDialogProps {
    revisionId: string
    /** The key of the prompt in the revision's config, such as `prompt`. */
    promptKey: string
    onClose: () => void
}

const CloseButton = ({onClose, className}: {onClose: () => void; className?: string}) => {
    const t = useT(refineCatalog)
    return (
        <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("playground.refine.closeModal")}
            onClick={onClose}
            className={className}
        >
            <X size={14} aria-hidden />
        </Button>
    )
}

/**
 * Refine prompt: the user writes instructions, the refine tool rewrites the prompt's messages,
 * and "Use refined prompt" puts them into the revision's draft. Nothing is saved. Mount it only
 * while open: closing it drops the conversation. On a phone the two sides become two panes.
 */
export const RefinePromptDialog = ({revisionId, promptKey, onClose}: RefinePromptDialogProps) => {
    const t = useT(refineCatalog)
    const panes = [
        {value: "instructions", label: t("playground.refine.instructions")},
        {value: "preview", label: t("playground.refine.refinePrompt")},
    ]
    const refine = useRefinePrompt(revisionId, promptKey)
    const [input, setInput] = useState("")
    const [showDiff, setShowDiff] = useState(false)
    const [pane, setPane] = useState<Pane>("instructions")
    const hasResult = refine.working !== null

    const send = async (guidelines: string) => {
        setInput("")
        if (await refine.refine(guidelines)) setPane("preview")
    }

    const applyRefined = () => {
        refine.apply()
        onClose()
    }

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                showCloseButton={false}
                aria-describedby={undefined}
                className="h-[min(90vh,720px)] max-w-[1040px] gap-0 overflow-hidden p-0"
                onKeyDown={(event) => {
                    // The instructions box handles its own Enter and marks it handled.
                    if (event.defaultPrevented) return
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault()
                        void send(input)
                    }
                }}
            >
                <DialogTitle className="sr-only">{t("playground.refine.refinePrompt")}</DialogTitle>
                <div className="flex items-center gap-2 border-0 border-b border-solid border-border px-3 py-2 sm:hidden">
                    <Segmented
                        size="sm"
                        options={panes}
                        value={pane}
                        onChange={(value) => setPane(value as Pane)}
                    />
                    <CloseButton onClose={onClose} className="ml-auto" />
                </div>
                <div className="flex min-h-0 flex-1">
                    <div
                        className={clsx(
                            "min-h-0 w-full flex-col sm:flex sm:w-1/2 sm:border-0 sm:border-r sm:border-solid sm:border-border",
                            pane === "instructions" ? "flex" : "hidden",
                        )}
                    >
                        <div className="hidden border-0 border-b border-solid border-border px-4 py-3 sm:block">
                            <p className="m-0 text-[13px] font-medium text-foreground">
                                {t("playground.refine.instructions")}
                            </p>
                            <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                                {t("playground.refine.chatWithAgent")}
                            </p>
                        </div>
                        <RefineInstructions
                            rounds={refine.rounds}
                            pending={refine.pending}
                            input={input}
                            onInputChange={setInput}
                            onSend={send}
                        />
                    </div>
                    <div
                        className={clsx(
                            "min-h-0 w-full flex-col sm:flex sm:w-1/2",
                            pane === "preview" ? "flex" : "hidden",
                        )}
                    >
                        <div className="flex items-center gap-3 border-0 border-b border-solid border-border px-4 py-2 sm:py-3">
                            <p className="m-0 hidden text-[13px] font-medium text-foreground sm:block">
                                {t("playground.refine.refinePrompt")}
                            </p>
                            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                                {t("playground.refine.diff")}
                                <Switch
                                    size="sm"
                                    checked={showDiff}
                                    onCheckedChange={setShowDiff}
                                    disabled={!hasResult}
                                    aria-label={t("playground.refine.toggleDiff")}
                                />
                            </label>
                            <CloseButton onClose={onClose} className="hidden sm:inline-flex" />
                        </div>
                        <RefinePreview
                            promptKey={promptKey}
                            original={refine.original}
                            working={refine.working}
                            version={refine.version}
                            showDiff={showDiff}
                            busy={refine.pending !== null}
                            onEditMessage={refine.editMessage}
                        />
                        <div className="flex items-center justify-end gap-2 border-0 border-t border-solid border-border px-4 py-3">
                            <Button variant="ghost" size="sm" onClick={onClose}>
                                {t("playground.refine.cancel")}
                            </Button>
                            <Button size="sm" onClick={applyRefined} disabled={!hasResult}>
                                {t("playground.refine.useRefined")}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
