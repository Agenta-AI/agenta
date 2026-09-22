/**
 * The one question before an app runs: what may it touch. Read files, or read and write them —
 * preselected from the manifest's `access`, the write option only offered where the user may edit
 * mounts at all. A third, empty, hidden section is reserved for what comes next (tools, network).
 */
import {useEffect, useState} from "react"

import {type GrantLevel} from "@agenta/entities/drive"
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
    pending?: boolean
    onCancel: () => void
    onConfirm: (level: GrantLevel) => void
}

export function GrantSheet({
    open,
    appName,
    dir,
    requested,
    canWrite,
    pending = false,
    onCancel,
    onConfirm,
}: GrantSheetProps) {
    const preselected: GrantLevel = canWrite ? requested : "read"
    const [level, setLevel] = useState<GrantLevel>(preselected)
    useEffect(() => {
        if (open) setLevel(preselected)
    }, [open, preselected])

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
            <DialogContent className="max-w-sm gap-4 text-xs" showCloseButton={false}>
                <DialogHeader className="gap-1">
                    <DialogTitle className="text-sm">Run {appName}?</DialogTitle>
                    <DialogDescription className="text-xs text-colorTextSecondary">
                        This app can use files in{" "}
                        <code className="rounded bg-colorFillSecondary px-1 py-0.5 text-[11px] text-colorText">
                            {dir || "/"}
                        </code>
                    </DialogDescription>
                </DialogHeader>

                <section aria-label="File access" data-slot="grant-sheet-access">
                    <RadioGroup
                        value={level}
                        onValueChange={(v) => setLevel(v as GrantLevel)}
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
                    </RadioGroup>
                </section>

                {/* Reserved slot: the next grant (tools, network) renders here without a redesign. */}
                <section data-slot="grant-sheet-extra" hidden aria-hidden />

                <p className="m-0 text-xs text-colorTextTertiary">
                    The app never receives your login. Agenta makes the file calls for it.
                </p>

                <DialogFooter className="gap-2">
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => onConfirm(canWrite ? level : "read")}
                    >
                        {pending ? "Loading permissions…" : "Run"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
