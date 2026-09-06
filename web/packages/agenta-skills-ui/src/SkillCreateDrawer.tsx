/**
 * Create-a-skill flow, one drawer with two entry modes (the design's 1b–1e states):
 *
 * - "write" opens the editor shell (SkillFormView) empty.
 * - "upload" opens as a FULL-DRAWER dropzone (1c — nothing is created until you review).
 *   One valid skill morphs the drawer into the editor prefilled (1d, with an
 *   "N files parsed" tag); invalid or multi-skill uploads keep their errors and the
 *   recovery list IN the upload view (1e), never in the editor.
 *
 * Connected on purpose: create + invalidation live here once; hosts pass `projectId`.
 */
import {useCallback, useState} from "react"

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

import {SkillUploadPanel} from "./SkillUploadPanel"

export interface SkillCreateDrawerProps {
    open: boolean
    onClose: () => void
    projectId: string
    /** "write" opens the editor; "upload" opens the full-drawer dropzone (1c). */
    mode?: "write" | "upload"
    /** Fires once per created skill — e.g. to also add it to the agent being edited. */
    onCreated?: (created: {
        slug: string
        workflowId?: string
        name: string
        description?: string
    }) => void
    /** Editor-stage width; the upload stage stays at `uploadWidth` and the resize animates. */
    width?: number
    uploadWidth?: number
}

const EMPTY_SKILL: Record<string, unknown> = {name: "", description: "", body: "", files: []}

/** First zod issue → one human line ("name is required"), not raw zod copy. */
const firstIssue = (error: {issues: {path: PropertyKey[]; message: string}[]}): string => {
    const issue = error.issues[0]
    if (!issue) return "Invalid skill."
    const path = issue.path.join(".")
    const message = /Too small.*>=1/.test(issue.message) ? "is required" : issue.message
    return path ? `${path} ${message}` : message
}

const toFormValue = (candidate: SkillScanCandidate): Record<string, unknown> => ({
    name: candidate.skill.name ?? "",
    description: candidate.skill.description ?? "",
    body: candidate.skill.body,
    files: candidate.skill.files,
})

export function SkillCreateDrawer({
    open,
    onClose,
    projectId,
    mode = "write",
    onCreated,
    width = 960,
    uploadWidth = 520,
}: SkillCreateDrawerProps) {
    const [value, setValue] = useState<Record<string, unknown>>(EMPTY_SKILL)
    // Upload mode sits in the dropzone stage until a parse succeeds; write mode never does.
    const [stage, setStage] = useState<"upload" | "editor">(mode === "upload" ? "upload" : "editor")
    const [parsedCount, setParsedCount] = useState<number | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Closing only closes: the host may clear its mode state immediately, and any reset
    // here would restage (and resize) the drawer while its exit animation still shows it.
    const close = useCallback(() => {
        onClose()
        setBusy(false)
    }, [onClose])

    // All state reset happens on the OPEN transition, when the incoming mode is the real
    // one — a fresh drawer per entry, and a stable frame throughout the exit animation.
    const [wasOpen, setWasOpen] = useState(false)
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) {
            setValue(EMPTY_SKILL)
            setStage(mode === "upload" ? "upload" : "editor")
            setParsedCount(null)
            setError(null)
        }
    }

    const handleSingleSkill = useCallback(
        (candidate: SkillScanCandidate, scan: SkillUploadScan) => {
            setValue(toFormValue(candidate))
            setParsedCount(scan.fileCount)
            setStage("editor")
        },
        [],
    )

    const createOne = useCallback(
        async (skill: Record<string, unknown>) => {
            const parsed = skillContentSchema.safeParse(skill)
            if (!parsed.success) throw new Error(firstIssue(parsed.error))
            const created = (await createSkillWorkflow({projectId, skill: parsed.data})) as
                | Record<string, unknown>
                | undefined
            onCreated?.({
                slug: parsed.data.name,
                workflowId:
                    typeof created?.workflow_id === "string" ? created.workflow_id : undefined,
                name: parsed.data.name,
                description: parsed.data.description,
            })
        },
        [onCreated, projectId],
    )

    const create = useCallback(async () => {
        const parsed = skillContentSchema.safeParse(value)
        if (!parsed.success) {
            setError(firstIssue(parsed.error))
            return
        }
        setBusy(true)
        setError(null)
        try {
            const created = (await createSkillWorkflow({projectId, skill: parsed.data})) as
                | Record<string, unknown>
                | undefined
            invalidateSkillsListCache()
            onCreated?.({
                slug: parsed.data.name,
                workflowId:
                    typeof created?.workflow_id === "string" ? created.workflow_id : undefined,
                name: parsed.data.name,
                description: parsed.data.description,
            })
            close()
        } catch (err) {
            const status = (err as {response?: {status?: number}})?.response?.status
            setError(
                status === 409
                    ? `A skill named '${String(value.name)}' already exists in this project.`
                    : err instanceof Error && err.message
                      ? `Create failed: ${err.message}`
                      : "Create failed.",
            )
        } finally {
            setBusy(false)
        }
    }, [close, onCreated, projectId, value])

    // The recovery list's batch import: each selected candidate becomes its own skill.
    const importMany = useCallback(
        async (candidates: SkillScanCandidate[]) => {
            setError(null)
            try {
                for (const candidate of candidates) {
                    await createOne(toFormValue(candidate))
                }
                invalidateSkillsListCache()
                close()
            } catch (err) {
                // The panel owns the view; the footer carries the failure line.
                setError(err instanceof Error && err.message ? err.message : "Import failed.")
            }
        },
        [close, createOne],
    )

    const uploading = stage === "upload"

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={close}
            placement="right"
            // The drawer sizes to its stage: the dropzone/recovery view stays compact, the
            // editor takes the wide frame, and the resize animates between them.
            width={uploading ? uploadWidth : width}
            destroyOnClose
            title={
                <div className="flex items-center gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">New skill</span>
                        <span className="text-xs font-normal text-[var(--ag-colorTextSecondary)]">
                            {uploading
                                ? "Upload a skill folder, .zip or .skill — review before anything is created."
                                : "Write it here, or drop a folder, .zip or .skill into the file rail."}
                        </span>
                    </div>
                    {parsedCount != null ? (
                        <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px text-[10px] tabular-nums text-[var(--ag-colorTextTertiary)]">
                            {parsedCount} {parsedCount === 1 ? "file" : "files"} parsed
                        </span>
                    ) : null}
                </div>
            }
            styles={{
                content: {transition: "width 0.25s ease"},
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
                        {/* The upload stage's actions live in its own view (Import N skills);
                            Create belongs to the editor alone. */}
                        {!uploading ? (
                            <Button onClick={create} disabled={busy}>
                                {busy ? <Spinner size="small" /> : null}
                                Create skill
                            </Button>
                        ) : null}
                    </span>
                </div>
            }
        >
            {uploading ? (
                <SkillUploadPanel
                    onSingleSkill={handleSingleSkill}
                    onImportMany={importMany}
                    disabled={busy}
                />
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <SkillFormView value={value} onChange={setValue} disabled={busy} />
                </div>
            )}
        </EnhancedDrawer>
    )
}
