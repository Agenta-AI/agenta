/**
 * DriveNameDialog — the one prompt behind New folder / New file / Rename / Duplicate / Move to…:
 * a name (or, for Move, a destination folder path) with the validation the mount needs — no
 * empty names, no `/` inside a name, no `..`, no clash with a sibling. Submit on Enter.
 */
import {type FormEvent, useEffect, useMemo, useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
} from "@agenta/ui/ui"

export type DriveNameDialogKind = "new-folder" | "new-file" | "rename" | "duplicate" | "move"

export interface DriveNameDialogRequest {
    kind: DriveNameDialogKind
    /** The item being renamed / duplicated / moved (presented path); the folder for new items. */
    path: string
    /** Sibling names in the target folder — the clash check. */
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
    duplicate: {title: "Duplicate", label: "Name for the copy", action: "Duplicate", placeholder: ""},
    move: {title: "Move to…", label: "Destination folder", action: "Move", placeholder: "folder/sub"},
}

const nameOf = (path: string) => path.split("/").pop() ?? path
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")))

/** "article.md" → "article copy.md"; "notes" → "notes copy". */
const copyName = (name: string) => {
    const dot = name.lastIndexOf(".")
    return dot > 0 ? `${name.slice(0, dot)} copy${name.slice(dot)}` : `${name} copy`
}

const validate = (kind: DriveNameDialogKind, value: string, req: DriveNameDialogRequest) => {
    const v = value.trim()
    if (kind === "move") {
        if (v.split("/").some((seg) => seg === "..")) return "The path can't contain “..”"
        if (v === folderOf(req.path)) return "The file is already in that folder"
        return null
    }
    if (!v) return "Enter a name"
    if (v.includes("/")) return "A name can't contain “/”"
    if (v === "." || v === "..") return "That name isn't allowed"
    if (v === nameOf(req.path) && (kind === "rename" || kind === "duplicate"))
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
    // Seed per request: the current name for rename, "<name> copy" for duplicate, the current
    // folder for move, empty for new items.
    useEffect(() => {
        if (!request) return
        setTouched(false)
        setValue(
            request.kind === "rename"
                ? nameOf(request.path)
                : request.kind === "duplicate"
                  ? copyName(nameOf(request.path))
                  : request.kind === "move"
                    ? folderOf(request.path)
                    : "",
        )
    }, [request])
    const error = useMemo(
        () => (request ? validate(request.kind, value, request) : null),
        [request, value],
    )
    const copy = request ? COPY[request.kind] : null
    const submit = (e?: FormEvent) => {
        e?.preventDefault()
        setTouched(true)
        if (!request || error || busy) return
        onSubmit(request, value.trim().replace(/^\/+|\/+$/g, ""))
    }
    return (
        <Dialog open={request !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
            <DialogContent className="max-w-sm">
                <form onSubmit={submit} className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle>{copy?.title}</DialogTitle>
                        {request && request.kind !== "move" && request.kind.startsWith("new") ? (
                            <DialogDescription>
                                In {request.path ? request.path : "All files"}
                            </DialogDescription>
                        ) : request?.kind === "move" ? (
                            <DialogDescription>
                                Move {nameOf(request.path)} to a folder (empty = All files)
                            </DialogDescription>
                        ) : null}
                    </DialogHeader>
                    <label className="flex flex-col gap-1.5 text-xs text-colorTextSecondary">
                        {copy?.label}
                        <Input
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
                    </label>
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
