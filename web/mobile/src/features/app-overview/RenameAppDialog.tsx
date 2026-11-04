import {useState, type FormEvent, type ReactNode} from "react"

import {workflowLatestRevisionQueryAtomFamily, type Workflow} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {FormattedDate} from "@agenta/ui/components/presentational"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Skeleton,
    Textarea,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Copy} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useAppRename} from "./useAppRename"

const Detail = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
        <span className="shrink-0 text-muted-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-1">{children}</span>
    </div>
)

/**
 * Edit the name and description of an app, and read its fixed details. Mount it only while it is
 * open, so the fields start from the stored values each time.
 */
export const RenameAppDialog = ({
    projectId,
    app,
    onClose,
}: {
    projectId: string
    app: Workflow
    onClose: () => void
}) => {
    const rename = useAppRename({projectId, app})
    const latest = useAtomValue(workflowLatestRevisionQueryAtomFamily(app.id))
    // `null` means "not edited yet": the field shows the stored value once it has loaded.
    const [nameDraft, setNameDraft] = useState<string | null>(null)
    const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    const name = nameDraft ?? rename.storedName
    const description = descriptionDraft ?? rename.storedDescription
    const nameError = nameDraft === null ? null : rename.validate(name)
    const loadingDescription = rename.descriptionState === "loading"
    const canSave = !pending && !loadingDescription && name.trim() !== "" && nameError === null
    const version = latest.data?.version

    const submit = async (event?: FormEvent) => {
        event?.preventDefault()
        if (!canSave) return
        const error = rename.validate(name)
        if (error) {
            setNameDraft(name)
            return
        }
        setPending(true)
        const ok = await rename.save({name, description})
        setPending(false)
        if (ok) onClose()
    }

    const copyId = async () => {
        if (await copyToClipboard(app.id)) message.success("Copied to clipboard!")
        else message.error("Couldn't copy the workflow ID")
    }

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{rename.storedName || "Untitled"}</DialogTitle>
                    <DialogDescription>Edit name, description & view details</DialogDescription>
                </DialogHeader>
                <form
                    className="flex min-w-0 flex-col gap-4"
                    onSubmit={(event) => void submit(event)}
                >
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Name
                        <Input
                            value={name}
                            aria-invalid={nameError !== null}
                            onChange={(event) => setNameDraft(event.target.value)}
                        />
                        {nameError ? (
                            <span role="alert" className="text-sm font-normal text-destructive">
                                {nameError}
                            </span>
                        ) : null}
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Description
                        {loadingDescription ? (
                            <Skeleton className="h-[72px] w-full" />
                        ) : (
                            <Textarea
                                value={description}
                                rows={3}
                                placeholder="Add a short description…"
                                disabled={rename.descriptionState === "failed"}
                                onChange={(event) => setDescriptionDraft(event.target.value)}
                            />
                        )}
                    </label>
                    <div className="flex flex-col gap-2 rounded-lg border border-solid border-border p-3">
                        {version != null ? <Detail label="Version">v{version}</Detail> : null}
                        {rename.createdAt ? (
                            <Detail label="Created">
                                <FormattedDate date={rename.createdAt} />
                            </Detail>
                        ) : null}
                        {app.slug ? (
                            <Detail label="Slug · fixed on rename">
                                <span className="truncate">{app.slug}</span>
                            </Detail>
                        ) : null}
                        <Detail label="Workflow ID">
                            <span className="truncate">{app.id}</span>
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Copy workflow ID"
                                onClick={() => void copyId()}
                            >
                                <Copy aria-hidden size={14} />
                            </Button>
                        </Detail>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={onClose}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!canSave}>
                            {pending ? "Saving…" : "Save changes"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
