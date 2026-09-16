/**
 * Create-a-skill flow: the editor shell (SkillFormView), empty. Files arrive through the
 * editor's own rail — there is no separate upload mode.
 *
 * Connected on purpose: create + invalidation live here once; hosts pass `projectId`.
 */
import {useCallback, useState} from "react"

import {SkillFormView} from "@agenta/entity-ui/drill-in"
import {createSkillWorkflow, skillContentSchema} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Spinner} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

export interface SkillCreateDrawerProps {
    open: boolean
    onClose: () => void
    projectId: string
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
    onCreated,
    width = 960,
}: SkillCreateDrawerProps) {
    const [value, setValue] = useState<Record<string, unknown>>(EMPTY_SKILL)
    const [busy, setBusy] = useState(false)
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
            setError(null)
        }
    }

    const create = useCallback(async () => {
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
            title={<span className="text-sm font-medium">New skill</span>}
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
                        <Button onClick={create} disabled={busy}>
                            {busy ? <Spinner size="small" /> : null}
                            Create skill
                        </Button>
                    </span>
                </div>
            }
        >
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <SkillFormView value={value} onChange={setValue} disabled={busy} />
            </div>
        </EnhancedDrawer>
    )
}
