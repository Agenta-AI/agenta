import {useState} from "react"

import {archiveSkill, querySkillReferencedBy} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    Spinner,
} from "@agenta/ui/ui"
import {useQueries} from "@tanstack/react-query"

import {skillUsageQueryKey} from "./SkillAgentPicker"

export interface ArchiveTarget {
    workflowId: string
    title: string
}

/** Confirms archiving one or more skills and names the agents that use them. */
export function SkillArchiveDialog({
    projectId,
    skills,
    onClose,
    onArchived,
}: {
    projectId: string
    /** Empty closes the dialog. */
    skills: ArchiveTarget[]
    onClose: () => void
    onArchived: (archived: ArchiveTarget[]) => void
}) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const open = skills.length > 0
    const many = skills.length > 1

    const usage = useQueries({
        queries: skills.map((skill) => ({
            queryKey: skillUsageQueryKey(projectId, skill.workflowId),
            queryFn: () => querySkillReferencedBy({projectId, workflowId: skill.workflowId}),
            enabled: open,
            staleTime: 15_000,
        })),
    })
    const agents = [
        ...new Set(
            usage.flatMap((query) =>
                (query.data?.referenced_by ?? []).map(
                    (entry) => entry.agent_name ?? entry.agent_slug ?? "Unnamed agent",
                ),
            ),
        ),
    ]
    const loadingUsage = usage.some((query) => query.isPending)

    const title = many ? `Archive ${skills.length} skills?` : `Archive ${skills[0]?.title ?? ""}?`
    const text = agents.length
        ? many
            ? "The agents below stop using them. You can restore any skill later from Archived."
            : "The agents below stop using it. You can restore it later from Archived."
        : many
          ? "No agent uses these skills. You can restore them later from Archived."
          : "No agent uses it. You can restore it later from Archived."

    const run = async () => {
        setBusy(true)
        setError(null)
        const done: ArchiveTarget[] = []
        try {
            for (const skill of skills) {
                await archiveSkill({projectId, workflowId: skill.workflowId})
                done.push(skill)
            }
            onArchived(done)
        } catch (err) {
            setError(err instanceof Error && err.message ? err.message : "Archiving failed.")
        } finally {
            if (done.length) invalidateSkillsListCache()
            setBusy(false)
        }
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !busy) {
                    setError(null)
                    onClose()
                }
            }}
        >
            <AlertDialogContent className="sm:max-w-[400px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {loadingUsage ? "Checking which agents use it…" : text}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {agents.length ? (
                    <div className="flex flex-col gap-1.5 text-sm">
                        <span className="font-medium">Used by</span>
                        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-[18px]">
                            {agents.map((name) => (
                                <li key={name}>{name}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}
                {error ? <p className="m-0 text-xs text-destructive">{error}</p> : null}
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" disabled={busy}>
                            Cancel
                        </Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                        <Button
                            variant="destructive"
                            disabled={busy || loadingUsage}
                            onClick={(event) => {
                                event.preventDefault()
                                void run()
                            }}
                        >
                            {busy ? <Spinner size="small" /> : null}
                            {many ? `Archive ${skills.length} skills` : "Archive skill"}
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
