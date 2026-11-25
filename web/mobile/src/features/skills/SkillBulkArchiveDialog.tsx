import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {projectIdAtom} from "@agenta/shared/state"
import {querySkillReferencedBy} from "@agenta/skills"
import {skillUsageQueryKey} from "@agenta/skills-ui"
import {useQueries} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {ConfirmModal} from "../settings/ConfirmModal"

import type {SkillListRow} from "./skillListView"

/** The bulk Archive confirm: names the skills and the agents that use them. */
export const SkillBulkArchiveDialog = ({
    open,
    rows,
    pending,
    onConfirm,
    onClose,
}: {
    open: boolean
    rows: SkillListRow[]
    pending: boolean
    onConfirm: () => void
    onClose: () => void
}) => {
    const t = useT(skillsListCatalog)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    // Only a skill some agent uses is asked who; the same query the Used by cell runs.
    const used = useMemo(() => rows.filter((row) => row.usedByCount > 0), [rows])
    const usages = useQueries({
        queries: used.map((row) => ({
            queryKey: skillUsageQueryKey(projectId, row.id),
            queryFn: () => querySkillReferencedBy({projectId, workflowId: row.id}),
            enabled: open && Boolean(projectId),
            staleTime: 15_000,
        })),
    })
    const loadingAgents = usages.some((usage) => usage.isPending)
    const agents = [
        ...new Map(
            usages
                .flatMap((usage) => usage.data?.referenced_by ?? [])
                .map((ref) => [
                    ref.agent_workflow_id ?? ref.agent_slug ?? "",
                    ref.agent_name ?? ref.agent_slug ?? "",
                ]),
        ).values(),
    ].filter(Boolean)

    return (
        <ConfirmModal
            open={open}
            title={t("skills.list.bulkArchiveTitle", {count: rows.length})}
            description={t("skills.list.bulkArchiveMessage")}
            body={
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <span className="text-label text-muted-foreground">
                            {t("skills.list.bulkArchiveSkills")}
                        </span>
                        <span className="text-body text-foreground">
                            {rows.map((row) => row.title).join(", ")}
                        </span>
                    </div>
                    {/* The counts said some agent uses them, but the lookup found none: no row. */}
                    {used.length > 0 && !loadingAgents && agents.length === 0 ? null : (
                        <div className="flex flex-col gap-1">
                            <span className="text-label text-muted-foreground">
                                {t("skills.list.bulkArchiveAgents")}
                            </span>
                            <span className="text-body text-foreground">
                                {used.length === 0
                                    ? t("skills.list.bulkArchiveNoAgents")
                                    : loadingAgents
                                      ? t("skills.list.bulkArchiveCheckingAgents")
                                      : agents.join(", ")}
                            </span>
                        </div>
                    )}
                </div>
            }
            confirmLabel={t("skills.list.archive")}
            pending={pending}
            onConfirm={onConfirm}
            onClose={onClose}
        />
    )
}
