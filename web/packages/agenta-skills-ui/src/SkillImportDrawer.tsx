/**
 * Import skills from a repo, over the shared `RepoImportDrawer`. Connected on purpose:
 * scan/import/invalidation live here once instead of in every host.
 */
import {useCallback} from "react"

import {formatCount} from "@agenta/shared/utils"
import {importSkillSource, scanSkillSource} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {RepoImportDrawer, type RepoScanResult} from "@agenta/ui/create-menu"
import {CheckCircle, WarningCircle} from "@phosphor-icons/react"

export interface SkillImportDrawerProps {
    open: boolean
    onClose: () => void
    projectId: string
    /** Fires once per successful import with what landed — e.g. to also add them to an agent. */
    onImported?: (imported: {name?: string; workflowId?: string; pathInRepo: string}[]) => void
}

const issueText = (issues?: {message?: string | null}[] | null): string =>
    issues
        ?.map((i) => i.message)
        .filter(Boolean)
        .join(" ") || "Invalid skill."

export function SkillImportDrawer({open, onClose, projectId, onImported}: SkillImportDrawerProps) {
    const scan = useCallback(
        async (repoUrl: string): Promise<RepoScanResult> => {
            const response = await scanSkillSource({projectId, repoUrl})
            const already = new Set(response?.already_imported_paths ?? [])
            const found = response?.scan?.candidates ?? []
            const valid = found.filter((c) => c.valid)
            return {
                candidates: found.map((c) => {
                    const imported = already.has(c.path_in_repo)
                    return {
                        path: c.path_in_repo,
                        name: c.skill?.name ?? c.path_in_repo,
                        description: c.skill?.description,
                        // Already-linked skills are Refresh's job, not a re-import.
                        unavailable: imported
                            ? "Already in this project — check for updates to pick up upstream changes."
                            : c.valid
                              ? null
                              : issueText(c.issues),
                        badge: imported ? "Already imported" : undefined,
                    }
                }),
                note:
                    valid.length === 0
                        ? "No valid skills in this repository."
                        : valid.every((c) => already.has(c.path_in_repo))
                          ? "Everything here is already imported — use Refresh on the repo's section to pick up upstream changes."
                          : undefined,
            }
        },
        [projectId],
    )

    const confirm = useCallback(
        async (repoUrl: string, paths: string[]) => {
            const response = await importSkillSource({projectId, repoUrl, paths})
            if (!response) throw new Error("the server returned an unexpected response")
            invalidateSkillsListCache()
            const imported = response.imported ?? []
            const skipped = response.skipped ?? []
            if (onImported && imported.length) {
                onImported(
                    imported.map((entry) => ({
                        name: entry.name ?? undefined,
                        workflowId: entry.workflow_id ?? undefined,
                        pathInRepo: entry.path_in_repo,
                    })),
                )
            }
            return (
                <div className="flex flex-col gap-3 text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                        <CheckCircle
                            size={14}
                            weight="fill"
                            className="text-[var(--ag-colorSuccess)]"
                        />
                        Imported {formatCount(imported.length, "skill")}
                    </span>
                    {imported.map((item) => (
                        <span key={item.path_in_repo} className="pl-5 font-mono">
                            {item.name ?? item.path_in_repo}
                        </span>
                    ))}
                    {skipped.length ? (
                        <>
                            <span className="mt-2 flex items-center gap-1.5 font-medium">
                                <WarningCircle
                                    size={14}
                                    weight="fill"
                                    className="text-[var(--ag-colorWarning)]"
                                />
                                Skipped {skipped.length}
                            </span>
                            {skipped.map((item) => (
                                <span
                                    key={item.path_in_repo}
                                    className="pl-5 text-[var(--ag-colorTextSecondary)]"
                                >
                                    <span className="font-mono">{item.path_in_repo}</span> —{" "}
                                    {issueText(item.issues)}
                                </span>
                            ))}
                        </>
                    ) : null}
                </div>
            )
        },
        [onImported, projectId],
    )

    return (
        <RepoImportDrawer
            open={open}
            onClose={onClose}
            title="Import skills from a repo"
            hint="Scan a public GitHub repository for SKILL.md folders."
            noun="skills"
            multiple
            scan={scan}
            confirmLabel={(count) => `Import ${formatCount(count, "skill")}`}
            onConfirm={confirm}
        />
    )
}
