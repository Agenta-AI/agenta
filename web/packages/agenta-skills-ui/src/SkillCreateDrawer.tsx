/**
 * Create-a-skill flow: the editor shell (SkillFormView), empty — or prefilled from an
 * `upload`, the scan of what the host's file picker returned. A folder holding several skills
 * becomes a pick list with a batch import instead. Nothing is created until Create / Import.
 *
 * Connected on purpose: create + invalidation live here once; hosts pass `projectId`.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {
    SkillFormView,
    type SkillScanCandidate,
    type SkillUploadScan,
} from "@agenta/entity-ui/drill-in"
import {createSkillWorkflow, skillContentSchema} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Checkbox, Spinner} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

export interface SkillCreateDrawerProps {
    open: boolean
    onClose: () => void
    projectId: string
    /**
     * A picked upload, still being read. The drawer opens on what it finds: one skill fills
     * the form; several become a pick list to import together; none leaves the form empty with
     * the reason in the footer.
     */
    upload?: Promise<SkillUploadScan> | null
    /** Fires once per created skill — e.g. to also add it to the agent being edited. */
    onCreated?: (created: {
        slug: string
        workflowId?: string
        name: string
        description?: string
    }) => void
    width?: number
}

const EMPTY_SKILL: Record<string, unknown> = {name: "", description: "", body: "", files: []}

const toFormValue = (candidate: SkillScanCandidate): Record<string, unknown> => ({
    name: candidate.skill.name ?? "",
    description: candidate.skill.description ?? "",
    body: candidate.skill.body,
    files: candidate.skill.files,
})

/** What an upload of several skills shows in place of the editor: the skills, each ticked. */
interface UploadPicks {
    scan: SkillUploadScan
    selected: Set<string>
}

export function SkillCreateDrawer({
    open,
    onClose,
    projectId,
    upload = null,
    onCreated,
    width = 960,
}: SkillCreateDrawerProps) {
    const [value, setValue] = useState<Record<string, unknown>>(EMPTY_SKILL)
    const [busy, setBusy] = useState(false)
    const [reading, setReading] = useState(false)
    // The empty-field chrome waits for a Create press; a blank form is not yet a mistake.
    const [attempted, setAttempted] = useState(false)
    const [parsedCount, setParsedCount] = useState<number | null>(null)
    const [picks, setPicks] = useState<UploadPicks | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Closing only closes: a reset here would blank the drawer while its exit animation
    // still shows it.
    const close = useCallback(() => {
        onClose()
        setBusy(false)
    }, [onClose])

    // All state reset happens on the OPEN transition — a fresh drawer per entry, and a
    // stable frame throughout the exit animation.
    const [wasOpen, setWasOpen] = useState(false)
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) {
            setValue(EMPTY_SKILL)
            setParsedCount(null)
            setPicks(null)
            setAttempted(false)
            setError(null)
        }
    }

    // The upload is read once per open. A drawer closed mid-read ignores the late answer, and
    // so does one reopened on a different upload.
    useEffect(() => {
        if (!open || !upload) return
        let live = true
        setReading(true)
        upload
            .then((scan) => {
                if (!live) return
                const [first] = scan.candidates
                if (!first) {
                    setError("No SKILL.md found in the upload.")
                    return
                }
                setParsedCount(scan.fileCount)
                if (scan.candidates.length === 1) {
                    setValue(toFormValue(first))
                    return
                }
                // Everything found starts ticked; unticking is the exception.
                setPicks({scan, selected: new Set(scan.candidates.map((c) => c.dir))})
            })
            .catch(() => {
                if (live) setError("Couldn't read the upload.")
            })
            .finally(() => {
                if (live) setReading(false)
            })
        return () => {
            live = false
        }
    }, [open, upload])

    /** One skill into the registry; the host hears about it. Throws on failure. */
    const createOne = useCallback(
        async (skill: Record<string, unknown>) => {
            const parsed = skillContentSchema.parse(skill)
            const created = await createSkillWorkflow({projectId, skill: parsed})
            onCreated?.({
                slug: created.slug,
                workflowId: created.workflowId,
                name: parsed.name,
                description: parsed.description,
            })
        },
        [onCreated, projectId],
    )

    const create = useCallback(async () => {
        setAttempted(true)
        // The fields say what is missing or malformed; the footer keeps to what the server said.
        if (!skillContentSchema.safeParse(value).success) return
        setBusy(true)
        setError(null)
        try {
            await createOne(value)
            invalidateSkillsListCache()
            close()
        } catch (err) {
            setError(
                err instanceof Error && err.message
                    ? `Create failed: ${err.message}`
                    : "Create failed.",
            )
        } finally {
            setBusy(false)
        }
    }, [close, createOne, value])

    const togglePick = useCallback((dir: string) => {
        setPicks((current) => {
            if (!current) return current
            const selected = new Set(current.selected)
            if (!selected.delete(dir)) selected.add(dir)
            return {...current, selected}
        })
    }, [])
    const chosen = useMemo(
        () => (picks ? picks.scan.candidates.filter((c) => picks.selected.has(c.dir)) : []),
        [picks],
    )

    const importMany = useCallback(async () => {
        if (!chosen.length) return
        setBusy(true)
        setError(null)
        let createdAny = false
        try {
            for (const candidate of chosen) {
                await createOne(toFormValue(candidate))
                createdAny = true
            }
            close()
        } catch (err) {
            setError(err instanceof Error && err.message ? `Import failed: ${err.message}` : "Import failed.")
        } finally {
            // A partial batch still created skills — the list must show them.
            if (createdAny) invalidateSkillsListCache()
            setBusy(false)
        }
    }, [chosen, close, createOne])

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={close}
            placement="right"
            width={width}
            destroyOnClose
            title={
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">New skill</span>
                    {parsedCount != null ? (
                        <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px text-[10px] font-normal tabular-nums text-[var(--ag-colorTextTertiary)]">
                            {parsedCount} {parsedCount === 1 ? "file" : "files"} parsed
                        </span>
                    ) : null}
                </div>
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                <div className="flex items-center justify-between gap-3">
                    {error ? (
                        <span className="flex min-w-0 items-start gap-1.5 text-xs text-[var(--ag-colorError)]">
                            <WarningCircle size={14} className="mt-px shrink-0" />
                            <span className="min-w-0">{error}</span>
                        </span>
                    ) : (
                        <span />
                    )}
                    <span className="flex shrink-0 items-center gap-2">
                        <Button variant="outline" onClick={close} disabled={busy}>
                            Cancel
                        </Button>
                        {picks ? (
                            <Button onClick={importMany} disabled={busy || chosen.length === 0}>
                                {busy ? <Spinner size="small" /> : null}
                                Import {chosen.length} {chosen.length === 1 ? "skill" : "skills"}
                            </Button>
                        ) : (
                            <Button onClick={create} disabled={busy || reading}>
                                {busy ? <Spinner size="small" /> : null}
                                Create skill
                            </Button>
                        )}
                    </span>
                </div>
            }
        >
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {reading ? (
                    <div className="flex h-full items-center justify-center">
                        <Spinner size="small" />
                    </div>
                ) : picks ? (
                    // Several skills in one upload: the editor edits one, so the drawer offers
                    // them as a list to bring in together, each as it was uploaded.
                    <div className="flex flex-col gap-1.5 text-xs">
                        <span className="font-medium">
                            Skills found · {picks.scan.candidates.length}
                        </span>
                        <div className="flex flex-col gap-1">
                            {picks.scan.candidates.map((candidate) => (
                                <label
                                    key={candidate.dir}
                                    className="box-border flex cursor-pointer items-start gap-2.5 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] p-2.5"
                                >
                                    <Checkbox
                                        className="mt-0.5 rounded"
                                        checked={picks.selected.has(candidate.dir)}
                                        disabled={busy}
                                        onCheckedChange={() => togglePick(candidate.dir)}
                                        aria-label={`Import ${candidate.skill.name || candidate.dir}`}
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="truncate font-mono">
                                            {candidate.skill.name || candidate.dir || "unnamed"}
                                        </span>
                                        <span className="line-clamp-1 text-[var(--ag-colorTextSecondary)]">
                                            {candidate.skill.description || candidate.dir || "No description"}
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                ) : (
                    <SkillFormView
                        value={value}
                        onChange={setValue}
                        disabled={busy}
                        // An upload arrives named; a blank form starts at its name.
                        autoFocusName={!upload}
                        showMissing={attempted}
                    />
                )}
            </div>
        </EnhancedDrawer>
    )
}
