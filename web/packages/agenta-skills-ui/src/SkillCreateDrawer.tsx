/**
 * Create-a-skill flow: the editor shell (SkillFormView), empty — or prefilled from an
 * `upload`, the scan of what the host's file picker returned. Nothing is created until Create.
 *
 * Connected on purpose: create + invalidation live here once; hosts pass `projectId`.
 */
import {useCallback, useEffect, useState} from "react"

import {
    SkillFormView,
    type SkillScanCandidate,
    type SkillUploadScan,
} from "@agenta/entity-ui/drill-in"
import {createSkillWorkflow, skillContentSchema} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Spinner} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

export interface SkillCreateDrawerProps {
    open: boolean
    onClose: () => void
    projectId: string
    /**
     * A picked upload, still being read. The editor opens on what it finds: one skill fills the
     * form; several fill it with the root one (or the first) and say so; none leaves it empty
     * with the reason in the footer.
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

/** First zod issue → one human line ("name is required"), not raw zod copy. */
const firstIssue = (error: {issues: {path: PropertyKey[]; message: string}[]}): string => {
    const issue = error.issues[0]
    if (!issue) return "Invalid skill."
    const path = issue.path.join(".")
    const message = /Too small.*>=1/.test(issue.message) ? "is required" : issue.message
    return path ? `${path} ${message}` : message
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
                const root = scan.candidates.find((c) => c.dir === "") ?? scan.candidates[0]
                if (!root) {
                    setError("No SKILL.md found in the upload.")
                    return
                }
                setValue(toFormValue(root))
                setParsedCount(scan.fileCount)
                if (scan.candidates.length > 1)
                    setError(
                        `${scan.candidates.length} skills found; the editor opened on ${root.dir || "the root one"}. Upload one skill at a time.`,
                    )
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

    const create = useCallback(async () => {
        setAttempted(true)
        const parsed = skillContentSchema.safeParse(value)
        if (!parsed.success) {
            setError(firstIssue(parsed.error))
            return
        }
        setBusy(true)
        setError(null)
        try {
            const created = await createSkillWorkflow({projectId, skill: parsed.data})
            invalidateSkillsListCache()
            onCreated?.({
                slug: created.slug,
                workflowId: created.workflowId,
                name: parsed.data.name,
                description: parsed.data.description,
            })
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
    }, [close, onCreated, projectId, value])

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
                        <Button onClick={create} disabled={busy || reading}>
                            {busy ? <Spinner size="small" /> : null}
                            Create skill
                        </Button>
                    </span>
                </div>
            }
        >
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {reading ? (
                    <div className="flex h-full items-center justify-center">
                        <Spinner size="small" />
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
