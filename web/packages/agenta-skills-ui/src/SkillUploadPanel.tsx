/**
 * The upload drawer's full-body surface (artboards 1c/1e). The convention it implements:
 * the FULL-DRAWER dropzone exists only in the truly-empty state; every error renders IN
 * this view — never by jumping into the editor — with the same dropzone below as the retry
 * target. One valid skill hands off to the editor (1d, the drawer morphs); several found
 * skills become a selectable recovery list with a batch import.
 */
import {useCallback, useMemo, useRef, useState} from "react"

import {
    scanSkillFromDataTransfer,
    scanSkillFromFileList,
    type SkillScanCandidate,
    type SkillUploadScan,
} from "@agenta/entity-ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {Button, Checkbox, Spinner} from "@agenta/ui/ui"
import {UploadSimple, Warning, WarningCircle} from "@phosphor-icons/react"

export interface SkillUploadPanelProps {
    /** Exactly one valid skill found — the drawer morphs into the editor with it (1d). */
    onSingleSkill: (candidate: SkillScanCandidate, scan: SkillUploadScan) => void
    /** The recovery list's batch action ("Import N skills"). May be async. */
    onImportMany: (candidates: SkillScanCandidate[], scan: SkillUploadScan) => void | Promise<void>
    disabled?: boolean
}

function Dropzone({
    large,
    busy,
    disabled,
    onScan,
}: {
    /** Full-body in the empty state; compact as the retry target under an error. */
    large: boolean
    busy: boolean
    disabled?: boolean
    onScan: (scan: Promise<SkillUploadScan>) => void
}) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [over, setOver] = useState(false)

    return (
        <div
            onDragOver={(e) => {
                if (disabled) return
                e.preventDefault()
                setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
                if (disabled) return
                e.preventDefault()
                setOver(false)
                onScan(scanSkillFromDataTransfer(e.dataTransfer))
            }}
            className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center transition-colors",
                "border-colorBorderSecondary",
                large ? "min-h-0 flex-1 py-10" : "py-6",
                over && "border-[var(--ag-c-586673)] bg-[var(--ag-c-F5F7FA)]",
                disabled && "opacity-60",
            )}
        >
            {busy ? (
                <Spinner size="small" />
            ) : (
                <UploadSimple size={large ? 28 : 20} className="text-[var(--ag-c-586673)]" />
            )}
            <div className="text-xs text-[var(--ag-c-586673)]">
                Drag a skill folder, <span className="font-mono">.zip</span>, or{" "}
                <span className="font-mono">.skill</span> here
            </div>
            <Button
                variant="outline"
                onClick={() => inputRef.current?.click()}
                disabled={disabled || busy}
            >
                Browse files
            </Button>
            {large ? (
                <div className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                    Nothing is created until you review.
                </div>
            ) : null}
            <input
                ref={inputRef}
                type="file"
                multiple
                accept=".zip,.skill,.md,text/markdown,text/plain"
                className="hidden"
                onChange={(e) => {
                    const list = e.target.files
                    if (list && list.length) onScan(scanSkillFromFileList(list))
                    e.target.value = ""
                }}
            />
        </div>
    )
}

/** Skipped-files warnings (gold, non-blocking) — shown in both outcomes. */
function SkippedList({skipped}: {skipped: SkillUploadScan["skipped"]}) {
    if (!skipped.length) return null
    return (
        <div className="flex flex-col gap-1 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2">
            {skipped.map((entry) => (
                <span
                    key={entry.path}
                    className="flex items-center gap-1.5 text-xs text-[var(--ag-colorWarningText)]"
                >
                    <Warning size={13} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono">{entry.path}</span>
                    <span className="shrink-0">skipped — {entry.reason}</span>
                </span>
            ))}
        </div>
    )
}

export function SkillUploadPanel({onSingleSkill, onImportMany, disabled}: SkillUploadPanelProps) {
    const [busy, setBusy] = useState(false)
    const [scan, setScan] = useState<SkillUploadScan | null>(null)
    const [readError, setReadError] = useState(false)
    const [selected, setSelected] = useState<Set<string>>(new Set())

    const handleScan = useCallback(
        (pending: Promise<SkillUploadScan>) => {
            setBusy(true)
            setReadError(false)
            void pending
                .then((result) => {
                    if (result.candidates.length === 1) {
                        onSingleSkill(result.candidates[0], result)
                        return
                    }
                    setScan(result)
                    // Recovery preselects everything found; unticking is the exception.
                    setSelected(new Set(result.candidates.map((c) => c.dir)))
                })
                .catch(() => {
                    setScan(null)
                    setReadError(true)
                })
                .finally(() => setBusy(false))
        },
        [onSingleSkill],
    )

    const toggle = useCallback((dir: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(dir)) next.delete(dir)
            else next.add(dir)
            return next
        })
    }, [])

    const chosen = useMemo(
        () => (scan ? scan.candidates.filter((c) => selected.has(c.dir)) : []),
        [scan, selected],
    )

    const importMany = useCallback(async () => {
        if (!scan || !chosen.length) return
        setBusy(true)
        try {
            await onImportMany(chosen, scan)
        } finally {
            setBusy(false)
        }
    }, [chosen, onImportMany, scan])

    // Truly empty (1c): the drawer IS the dropzone.
    if (!scan && !readError) {
        return (
            <div className="flex min-h-0 flex-1 flex-col p-4">
                <Dropzone large busy={busy} disabled={disabled} onScan={handleScan} />
            </div>
        )
    }

    const multiple = Boolean(scan && scan.candidates.length > 1)

    // Invalid / recovery (1e): the error owns the view; the dropzone below is the retry.
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex items-start gap-2 rounded-md border border-solid border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg)] px-3 py-2 text-xs text-[var(--ag-colorErrorText)]">
                <WarningCircle size={14} className="mt-px shrink-0" />
                <span className="min-w-0">
                    {readError
                        ? "Couldn't read that — drop a skill folder, a .zip, or a .skill file."
                        : multiple
                          ? scan!.candidates.some((c) => c.dir === "")
                              ? `This folder contains ${scan!.candidates.length} skills (the root plus nested ones). Pick the ones to import.`
                              : `No single skill at the root — ${scan!.candidates.length} skills found in nested folders. Pick the ones to import.`
                          : "No SKILL.md found in the upload. A skill needs a SKILL.md with name and description frontmatter."}
                </span>
            </div>

            {multiple ? (
                <>
                    <div className="flex flex-col overflow-hidden rounded-md border border-solid border-[var(--ag-colorBorderSecondary)]">
                        {scan!.candidates.map((candidate) => (
                            <label
                                key={candidate.dir}
                                className="flex cursor-pointer items-center gap-2.5 border-0 border-t border-solid border-[var(--ag-colorSplit)] px-3 py-2 first:border-t-0"
                            >
                                <Checkbox
                                    checked={selected.has(candidate.dir)}
                                    onCheckedChange={() => toggle(candidate.dir)}
                                    disabled={busy || disabled}
                                    aria-label={`Import ${candidate.skill.name || candidate.dir}`}
                                />
                                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                    {candidate.skill.name || candidate.dir || "unnamed"}
                                </span>
                                <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px font-mono text-[10px] text-[var(--ag-colorTextTertiary)]">
                                    SKILL.md
                                    {candidate.skill.files.length
                                        ? ` +${candidate.skill.files.length}`
                                        : ""}
                                </span>
                            </label>
                        ))}
                    </div>
                    <Button
                        onClick={() => void importMany()}
                        disabled={busy || disabled || chosen.length === 0}
                        className="self-start"
                    >
                        {busy ? <Spinner size="small" /> : null}
                        Import {chosen.length} {chosen.length === 1 ? "skill" : "skills"}
                    </Button>
                </>
            ) : null}

            {scan ? <SkippedList skipped={scan.skipped} /> : null}

            <Dropzone large={false} busy={busy} disabled={disabled} onScan={handleScan} />
        </div>
    )
}
