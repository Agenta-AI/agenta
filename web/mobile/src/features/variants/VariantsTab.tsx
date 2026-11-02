import {useCallback, useMemo, useState} from "react"

import {workflowLatestRevisionIdAtomFamily, type Workflow} from "@agenta/entities/workflow"
import {useSettledValue} from "@agenta/shared/hooks"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button, Segmented} from "@agenta/ui/ui"
import {CloudArrowUp} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useProjectPermission} from "../context/useProjectPermission"
import {useRevisionParam} from "../revisions/useRevisionParam"

import {DeleteRevisionDialog} from "./DeleteRevisionDialog"
import {DeployRevisionDialog} from "./DeployRevisionDialog"
import {VariantsEmpty} from "./states/VariantsEmpty"
import {VariantsNoMatch} from "./states/VariantsNoMatch"
import {useAppRevisions, type AppRevisionRow} from "./useAppRevisions"
import {VariantsTable} from "./VariantsTable"
import {
    readDisplayMode,
    toRevisionGroups,
    visibleRevisionIds,
    writeDisplayMode,
    type VariantsDisplayMode,
} from "./variantsView"

// The drawer and its config pane cost nothing until a reader opens a revision.
const RevisionDrawerHost = dynamic(
    () => import("../revisions/RevisionDrawerHost").then((module) => module.RevisionDrawerHost),
    {ssr: false},
)

const MODE_OPTIONS = [
    {label: "Variants", value: "variants"},
    {label: "Revisions", value: "revisions"},
]

/** The Variants tab: the revisions of one app, searchable, flat or grouped by variant. */
export const VariantsTab = ({projectId, app}: {projectId: string; app: Workflow}) => {
    const [search, setSearch] = useState("")
    const term = useSettledValue(search).trim()
    const [mode, setMode] = useState<VariantsDisplayMode>(readDisplayMode)
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const [deployRow, setDeployRow] = useState<AppRevisionRow | null>(null)
    const [deleteRow, setDeleteRow] = useState<AppRevisionRow | null>(null)
    const [revisionId, setRevisionId] = useRevisionParam()

    const revisions = useAppRevisions({projectId, appId: app.id, search: term})
    const latestRevisionId = useAtomValue(workflowLatestRevisionIdAtomFamily(app.id)) ?? null
    const canDeploy = useProjectPermission(projectId, "deploy_environments")
    const canDelete = useProjectPermission(projectId, "edit_workflows")

    const groups = useMemo(() => toRevisionGroups(revisions.rows, mode), [revisions.rows, mode])
    const navigationIds = useMemo(() => visibleRevisionIds(groups, collapsed), [groups, collapsed])
    const openRow = useCallback(
        (row: AppRevisionRow) => setRevisionId(row.revisionId),
        [setRevisionId],
    )

    const changeMode = (next: string) => {
        const value = next === "variants" ? "variants" : "revisions"
        setMode(value)
        writeDisplayMode(value)
    }

    const shownRow = revisionId
        ? (revisions.rows.find((row) => row.revisionId === revisionId) ?? null)
        : null

    if (revisions.isError) {
        return (
            <LoadError
                framed
                title="Could not load variants"
                onRetry={() => void revisions.refetch()}
            />
        )
    }

    const empty = term ? (
        <VariantsNoMatch term={term} onClear={() => setSearch("")} />
    ) : (
        <VariantsEmpty />
    )

    return (
        <>
            <ListTableToolbar
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search"
                actions={
                    <Segmented
                        className="ml-auto"
                        aria-label="Display mode"
                        options={MODE_OPTIONS}
                        value={mode}
                        onChange={(value) => changeMode(String(value))}
                    />
                }
            />
            <VariantsTable
                groups={groups}
                isLoading={revisions.isPending}
                latestRevisionId={latestRevisionId}
                canDeploy={canDeploy}
                canDelete={canDelete}
                collapsed={collapsed}
                onCollapsedChange={setCollapsed}
                onOpen={openRow}
                onDeploy={setDeployRow}
                onDelete={setDeleteRow}
                empty={empty}
            />
            {revisions.hasMore ? (
                <div className="flex justify-center pt-4">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={revisions.isLoadingMore}
                        onClick={() => void revisions.loadMore()}
                    >
                        Load more
                    </Button>
                </div>
            ) : null}

            {revisionId ? (
                <RevisionDrawerHost
                    kind="variant"
                    navigationIds={navigationIds}
                    actions={
                        canDeploy && shownRow ? (
                            <Button size="sm" onClick={() => setDeployRow(shownRow)}>
                                <CloudArrowUp aria-hidden size={14} />
                                Deploy
                            </Button>
                        ) : null
                    }
                />
            ) : null}
            {deployRow ? (
                <DeployRevisionDialog
                    key={deployRow.revisionId}
                    row={deployRow}
                    appId={app.id}
                    appSlug={app.slug ?? null}
                    onClose={() => setDeployRow(null)}
                />
            ) : null}
            {deleteRow ? (
                <DeleteRevisionDialog
                    key={deleteRow.revisionId}
                    row={deleteRow}
                    projectId={projectId}
                    appId={app.id}
                    onClose={() => setDeleteRow(null)}
                />
            ) : null}
        </>
    )
}
