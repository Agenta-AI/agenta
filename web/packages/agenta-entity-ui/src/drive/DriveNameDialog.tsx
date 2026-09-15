/** The one name prompt behind New folder / New file / Rename / Duplicate. */
import {type FormEvent, useEffect, useMemo, useState} from "react"

import {nameOf} from "@agenta/entities/drive"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
} from "@agenta/ui/ui"

export type DriveNameDialogKind = "new-folder" | "new-file" | "rename" | "duplicate"

export interface DriveNameDialogRequest {
    kind: DriveNameDialogKind
    /** The item (rename / duplicate) or the folder (new items). */
    path: string
    /** Sibling names in the target folder. */
    siblings: string[]
}

const COPY: Record<
    DriveNameDialogKind,
    {title: string; label: string; action: string; placeholder: string}
> = {
    "new-folder": {
        title: "New folder",
        label: "Folder name",
        action: "Create",
        placeholder: "notes",
    },
    "new-file": {title: "New file", label: "File name", action: "Create", placeholder: "notes.md"},
    rename: {title: "Rename", label: "New name", action: "Rename", placeholder: ""},
    duplicate: {
        title: "Duplicate",
        label: "Name for the copy",
        action: "Duplicate",
        placeholder: "",
    },
}

/** "article.md" → "article copy.md"; "notes" → "notes copy". */
const copyName = (name: string) => {
    const dot = name.lastIndexOf(".")
    return dot > 0 ? `${name.slice(0, dot)} copy${name.slice(dot)}` : `${name} copy`
}

/** Why `value` can't be used, or null. */
export const validateDriveName = (value: string, req: DriveNameDialogRequest) => {
    const v = value.trim()
    if (!v) return "Enter a name"
    if (v.includes("/")) return "A name can't contain “/”"
    if (v === "." || v === "..") return "That name isn't allowed"
    if (v === nameOf(req.path) && (req.kind === "rename" || req.kind === "duplicate"))
        return "Choose a different name"
    if (req.siblings.includes(v)) return "Something with that name already exists here"
    return null
}

export const DriveNameDialog = ({
    request,
    busy,
    onSubmit,
    onClose,
}: {
    request: DriveNameDialogRequest | null
    busy: boolean
    onSubmit: (request: DriveNameDialogRequest, value: string) => void
    onClose: () => void
}) => {
    const [value, setValue] = useState("")
    const [touched, setTouched] = useState(false)
    useEffect(() => {
        if (!request) return
        setTouched(false)
        setValue(
            request.kind === "rename"
                ? nameOf(request.path)
                : request.kind === "duplicate"
                  ? copyName(nameOf(request.path))
                  : "",
        )
    }, [request])
    const error = useMemo(
        () => (request ? validateDriveName(value, request) : null),
        [request, value],
    )
    const copy = request ? COPY[request.kind] : null
    const submit = (e?: FormEvent) => {
        e?.preventDefault()
        setTouched(true)
        if (!request || error || busy) return
        onSubmit(request, value.trim())
    }
    return (
        <Dialog open={request !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
            <DialogContent className="max-w-sm">
                <form onSubmit={submit} className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle>{copy?.title}</DialogTitle>
                        {request?.kind.startsWith("new") ? (
                            <DialogDescription>
                                In {request.path ? request.path : "All files"}
                            </DialogDescription>
                        ) : null}
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="drive-name-input"
                            className="text-xs text-colorTextSecondary"
                        >
                            {copy?.label}
                        </Label>
                        <Input
                            id="drive-name-input"
                            autoFocus
                            value={value}
                            placeholder={copy?.placeholder}
                            onChange={(e) => {
                                setValue(e.target.value)
                                setTouched(true)
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault()
                                    submit()
                                }
                            }}
                            aria-invalid={touched && error ? true : undefined}
                        />
                        {touched && error ? (
                            <span className="text-xs text-colorError">{error}</span>
                        ) : null}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={busy || Boolean(error)}>
                            {copy?.action}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
