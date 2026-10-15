import {useState, type ReactNode} from "react"

import {IMPORTED_TEMPLATE_MESSAGE, type AgentTemplateLoadRecovery} from "@agenta/entities/workflow"
import {
    Alert,
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    LoadingButton,
    Spinner,
    Textarea,
} from "@agenta/ui/ui"

import {TemplateIssueCard} from "./TemplateIssueCard"
import {TemplateReadyCard} from "./TemplateReadyCard"
import type {CreatedAgent} from "./useCreateAgent"
import {useTemplateImport, type TemplateImportStart} from "./useTemplateImport"

const RECOVERY_HINT: Partial<Record<AgentTemplateLoadRecovery, string>> = {
    retry: "Try again sends the same request, so it can't create a second agent.",
    start_over: "Start over sends a new request with the first message as it is now.",
    check_again:
        "The file changed after it was checked. Check it again to load the current version.",
}

export interface ImportTemplateDialogProps {
    open: boolean
    /** Remount (a new `key`) for each import, so every open starts clean. */
    start: TemplateImportStart
    onClose: () => void
    /** The agent and its first session exist; the host navigates to them. */
    onCreated: (agent: CreatedAgent) => void
}

/** Create an agent from a template zip the user picked, or one already in a session's files. */
export const ImportTemplateDialog = ({
    open,
    start,
    onClose,
    onCreated,
}: ImportTemplateDialogProps) => {
    const flow = useTemplateImport({start, onCreated})
    const {state} = flow
    const [message, setMessage] = useState(IMPORTED_TEMPLATE_MESSAGE)
    const fromFile = start.kind === "session_file"
    const backLabel = fromFile ? "Check again" : "Choose another file"

    const close = () => {
        // The request is already on the wire; closing would hide where it lands.
        if (state.at === "creating") return
        flow.dispose()
        onClose()
    }
    const cancel = (
        <Button variant="outline" onClick={close}>
            Cancel
        </Button>
    )
    const back = <Button onClick={() => void flow.back()}>{backLabel}</Button>

    let body: ReactNode
    let actions: ReactNode
    switch (state.at) {
        case "pick":
            body = state.fileProblem ? (
                <Alert type="error" showIcon message={state.fileProblem} />
            ) : null
            actions = (
                <>
                    {cancel}
                    {back}
                </>
            )
            break
        case "checking":
            body = (
                <div className="flex items-start gap-3 rounded-lg bg-muted p-4" aria-live="polite">
                    <Spinner className="mt-0.5" />
                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm text-foreground">
                            {state.step === "uploading"
                                ? "Uploading the zip…"
                                : "Checking the package…"}
                        </span>
                        <span
                            className="truncate text-xs text-muted-foreground"
                            title={state.label}
                        >
                            {state.label}
                        </span>
                    </div>
                </div>
            )
            actions = cancel
            break
        case "invalid":
            body = <TemplateIssueCard label={state.label} issue={state.issue} />
            actions = (
                <>
                    {cancel}
                    {back}
                </>
            )
            break
        case "check_failed":
            body = (
                <div className="flex flex-col gap-2">
                    <span className="truncate text-xs text-muted-foreground">{state.label}</span>
                    <Alert
                        type="error"
                        showIcon
                        message={state.error.message}
                        description={state.error.nextStep ?? undefined}
                    />
                </div>
            )
            actions = (
                <>
                    {cancel}
                    {back}
                </>
            )
            break
        case "ready":
        case "creating":
        case "create_failed": {
            const {checked} = state
            const locked = state.at !== "ready"
            body = (
                <>
                    <TemplateReadyCard label={checked.label} version={checked.version} />
                    <Field
                        label="First message"
                        description="The agent's first session starts with this message."
                    >
                        <Textarea
                            value={message}
                            rows={4}
                            disabled={locked}
                            onChange={(event) => setMessage(event.target.value)}
                        />
                    </Field>
                    {state.at === "create_failed" ? (
                        <Alert
                            type="error"
                            showIcon
                            message={state.error.message}
                            description={RECOVERY_HINT[state.recovery] ?? state.error.nextStep}
                        />
                    ) : null}
                </>
            )
            if (state.at === "create_failed") {
                const recover = {
                    retry: (
                        <Button onClick={() => void flow.create(checked, message)}>
                            Try again
                        </Button>
                    ),
                    start_over: <Button onClick={() => flow.startOver(checked)}>Start over</Button>,
                    check_again: <Button onClick={() => void flow.back()}>Check again</Button>,
                    edit_source: back,
                }[state.recovery]
                actions = (
                    <>
                        {cancel}
                        {recover}
                    </>
                )
            } else {
                actions = (
                    <>
                        {state.at === "ready" ? cancel : null}
                        <LoadingButton
                            loading={state.at === "creating"}
                            disabled={!message.trim()}
                            onClick={() => void flow.create(checked, message)}
                        >
                            {state.at === "creating" ? "Creating agent…" : "Create agent"}
                        </LoadingButton>
                    </>
                )
            }
            break
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && close()}>
            <DialogContent aria-describedby={undefined} showCloseButton={state.at !== "creating"}>
                <DialogHeader>
                    <DialogTitle>Create agent from a template</DialogTitle>
                </DialogHeader>
                {body ? <div className="flex min-w-0 flex-col gap-4">{body}</div> : null}
                <DialogFooter>{actions}</DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
