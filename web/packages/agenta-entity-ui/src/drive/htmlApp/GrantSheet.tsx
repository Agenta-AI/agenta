/**
 * The question an app raises when it first reaches for its files: read them, read and write them,
 * or nothing. Preselected from the manifest's `access`; the write option only where the user may
 * edit mounts. A hidden section is reserved for what comes next (tools, network).
 */
import {useEffect, useState} from "react"

import {type AppAccess, type GrantLevel} from "@agenta/entities/drive"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    RadioGroup,
    RadioGroupItem,
} from "@agenta/ui/ui"

export interface GrantSheetProps {
    open: boolean
    /** App name from the manifest, else the folder name. */
    appName: string
    /** App dir as presented to the user. */
    dir: string
    /** What the manifest asks for. Narrowed to `read` when writing is not offered. */
    requested: GrantLevel
    /** Whether the "Read and write files" option is offered at all. */
    canWrite: boolean
    /** A positioned pane to confine the sheet to; the rest of the page stays live. */
    container?: HTMLElement | null
    onCancel: () => void
    onConfirm: (level: AppAccess) => void
}

export function GrantSheet({
    open,
    appName,
    dir,
    requested,
    canWrite,
    container,
    onCancel,
    onConfirm,
}: GrantSheetProps) {
    const preselected: GrantLevel = canWrite ? requested : "read"
    const [level, setLevel] = useState<AppAccess>(preselected)
    useEffect(() => {
        if (open) setLevel(preselected)
    }, [open, preselected])

    return (
        <Dialog
            open={open}
            modal={!container}
            onOpenChange={(next) => (next ? undefined : onCancel())}
        >
            <DialogContent
                container={container}
                contained={!!container}
                className="max-w-sm gap-4 text-xs"
                showCloseButton={false}
            >
                <DialogHeader className="gap-1">
                    <DialogTitle className="text-sm">Let {appName} use files?</DialogTitle>
                    <DialogDescription className="text-xs text-colorTextSecondary">
                        The app asked to use files in{" "}
                        <code className="rounded bg-colorFillSecondary px-1 py-0.5 text-[11px] text-colorText">
                            {dir || "/"}
                        </code>
                    </DialogDescription>
                </DialogHeader>

                <section aria-label="File access" data-slot="grant-sheet-access">
                    <RadioGroup
                        value={level}
                        onValueChange={(v) => setLevel(v as AppAccess)}
                        className="flex flex-col gap-2"
                    >
                        <label className="flex cursor-pointer items-center gap-2">
                            <RadioGroupItem value="read" />
                            Read files
                        </label>
                        {canWrite ? (
                            <label className="flex cursor-pointer items-center gap-2">
                                <RadioGroupItem value="read-write" />
                                Read and write files
                            </label>
                        ) : null}
                        <label className="flex cursor-pointer items-center gap-2">
                            <RadioGroupItem value="none" />
                            Don't allow
                        </label>
                    </RadioGroup>
                </section>

                {/* Reserved slot: the next grant (tools, network) renders here without a redesign. */}
                <section data-slot="grant-sheet-extra" hidden aria-hidden />

                <p className="m-0 text-xs text-colorTextTertiary">
                    The app never receives your login. Agenta makes the file calls for it. Only run
                    apps you trust: the app's code can read these files and may be able to send what
                    it reads outside Agenta.
                </p>

                <DialogFooter className="gap-2">
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => onConfirm(canWrite || level === "none" ? level : "read")}
                    >
                        {level === "none" ? "Don't allow" : "Allow"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
