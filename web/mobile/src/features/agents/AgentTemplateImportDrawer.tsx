import {useCallback, useRef} from "react"

import {
    scanAgentTemplateSource,
    type AgentTemplateRepositoryScan,
    type AgentTemplateSource,
} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {RepoImportDrawer} from "@agenta/ui/create-menu"
import {useAtomValue} from "jotai"

/** Import an agent from a public GitHub repository: scan, pick one template, load it. */
export const AgentTemplateImportDrawer = ({
    open,
    onClose,
    onPick,
}: {
    open: boolean
    onClose: () => void
    onPick: (source: AgentTemplateSource) => Promise<boolean>
}) => {
    const projectId = useAtomValue(projectIdAtom)
    // The pick loads at the commit the scan resolved, not whatever the branch points at later.
    const scanned = useRef<AgentTemplateRepositoryScan | null>(null)

    const scan = useCallback(
        async (repoUrl: string) => {
            if (!projectId) throw new Error("No project is selected.")
            scanned.current = await scanAgentTemplateSource(projectId, {repo_url: repoUrl})
            return {candidates: scanned.current.templates}
        },
        [projectId],
    )

    const confirm = useCallback(
        async (_repoUrl: string, [path]: string[]) => {
            const {repo_url, commit} = scanned.current ?? {}
            // A failed create keeps the drawer open; its reason shows under the New agent button.
            if (!repo_url || !commit || !(await onPick({kind: "github", repo_url, commit, path})))
                throw new Error()
        },
        [onPick],
    )

    return (
        <RepoImportDrawer
            open={open}
            onClose={onClose}
            title="Import an agent from a repo"
            hint="Scan a public GitHub repository for agent templates."
            noun="agent templates"
            scan={scan}
            confirmLabel={() => "Create agent"}
            onConfirm={confirm}
        />
    )
}
