import {useState} from "react"

import {Button, Dialog, DialogContent, DialogTitle, Segmented, Switch} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"
import clsx from "clsx"

import {RefineInstructions} from "./RefineInstructions"
import {RefinePreview} from "./RefinePreview"
import {useRefinePrompt} from "./useRefinePrompt"

type Pane = "instructions" | "preview"

const PANES = [
    {value: "instructions", label: "Instructions"},
    {value: "preview", label: "Refine prompt"},
]

export interface RefinePromptDialogProps {
    revisionId: string
    /** The key of the prompt in the revision's config, such as `prompt`. */
    promptKey: string
    onClose: () => void
}

const CloseButton = ({onClose, className}: {onClose: () => void; className?: string}) => (
    <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close modal"
        onClick={onClose}
        className={className}
    >
        <X size={14} aria-hidden />
    </Button>
)

/**
 * Refine prompt: the user writes instructions, the refine tool rewrites the prompt's messages,
 * and "Use refined prompt" puts them into the revision's draft. Nothing is saved. Mount it only
 * while open: closing it drops the conversation. On a phone the two sides become two panes.
 */
export const RefinePromptDialog = ({revisionId, promptKey, onClose}: RefinePromptDialogProps) => {
    const refine = useRefinePrompt(revisionId, promptKey)
    const [input, setInput] = useState("")
    const [showDiff, setShowDiff] = useState(false)
    const [pane, setPane] = useState<Pane>("instructions")
    const hasResult = refine.working !== null

    const send = async (guidelines: string) => {
        if (!guidelines.trim() || refine.pending !== null) return
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
                <DialogTitle className="sr-only">Refine prompt</DialogTitle>
                <div className="flex items-center gap-2 border-0 border-b border-solid border-border px-3 py-2 sm:hidden">
                    <Segmented
                        size="sm"
                        options={PANES}
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
                                Instructions
                            </p>
                            <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                                Chat with an LLM agent to improve your prompt
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
                        <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-2 sm:py-3">
                            <p className="m-0 hidden text-[13px] font-medium text-foreground sm:block">
                                Refine prompt
                            </p>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                Diff
                                <Switch
                                    size="sm"
                                    checked={showDiff}
                                    onCheckedChange={setShowDiff}
                                    disabled={!hasResult}
                                    aria-label="Toggle diff view"
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
                            onEditMessage={refine.editMessage}
                        />
                        <div className="flex items-center justify-end gap-2 border-0 border-t border-solid border-border px-4 py-3">
                            <Button variant="ghost" size="sm" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button size="sm" onClick={applyRefined} disabled={!hasResult}>
                                Use refined prompt
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
