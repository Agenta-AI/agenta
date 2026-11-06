import {useCallback, useMemo, useState} from "react"

import {workflowLatestRevisionIdAtomFamily, type Workflow} from "@agenta/entities/workflow"
import {useSettledValue} from "@agenta/shared/hooks"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button, Segmented} from "@agenta/ui/ui"
import {ArrowsLeftRight, CloudArrowUp, Trash} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useProjectPermission} from "../context/useProjectPermission"
import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {playgroundHref} from "../playground/playgroundUrl"
import {OpenInPlaygroundButton} from "../revisions/OpenInPlaygroundButton"
import {useRevisionParam} from "../revisions/useRevisionParam"

import {DeleteRevisionDialog} from "./DeleteRevisionDialog"
import {DeleteSelectionDialog} from "./DeleteSelectionDialog"
import {DeployRevisionDialog} from "./DeployRevisionDialog"
import {
    selectedPair,
    singleSelectedRevision,
    toDeletion,
    toRegistryRows,
    type RegistryDeletion,
    type RegistryRow,
} from "./registryRows"
import {RegistryTable} from "./RegistryTable"
import {VariantsEmpty} from "./states/VariantsEmpty"
import {VariantsNoMatch} from "./states/VariantsNoMatch"
import {useAppRevisions, type AppRevisionRow} from "./useAppRevisions"
import {useShownRevisionRow} from "./useShownRevisionRow"
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
// Beta developer mode only; everyone else keeps the read-only drawer.
const EditableRevisionDrawerHost = dynamic(
    () =>
        import("../revisions/EditableRevisionDrawerHost").then(
            (module) => module.EditableRevisionDrawerHost,
        ),
    {ssr: false},
)

// The comparison and its diff editor load when a reader compares two revisions.
const CompareRevisionsDialog = dynamic(
    () => import("./CompareRevisionsDialog").then((module) => module.CompareRevisionsDialog),
    {ssr: false},
)

const MODE_OPTIONS = [
    {label: "Variants", value: "variants"},
    {label: "Revisions", value: "revisions"},
]

/** The Variants tab: the revisions of one app, searchable, flat or grouped by variant. */
export const VariantsTab = ({
    base,
    projectId,
    app,
}: {
    /** The project path, `/w/{workspace_id}/p/{project_id}`. */
    base: string
    projectId: string
    app: Workflow
}) => {
    const [search, setSearch] = useState("")
    const term = useSettledValue(search).trim()
    const [mode, setMode] = useState<VariantsDisplayMode>(readDisplayMode)
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const [deployRow, setDeployRow] = useState<AppRevisionRow | null>(null)
    const [deleteRow, setDeleteRow] = useState<AppRevisionRow | null>(null)
    const [revisionId, setRevisionId] = useRevisionParam()
    const betaDeveloperMode = useAtomValue(betaDeveloperModeActiveAtom)
    // Beta developer mode: the old app's Registry, with selection and expandable variants.
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
    const [selected, setSelected] = useState<Set<string>>(() => new Set())
    const [deletion, setDeletion] = useState<RegistryDeletion | null>(null)
    const [comparing, setComparing] = useState<[AppRevisionRow, AppRevisionRow] | null>(null)

    const revisions = useAppRevisions({projectId, appId: app.id, search: term})
    const latestRevisionId = useAtomValue(workflowLatestRevisionIdAtomFamily(app.id)) ?? null
    const canDeploy = useProjectPermission(projectId, "deploy_environments")
    const canDelete = useProjectPermission(projectId, "edit_workflows")
    const playgroundEnabled = useDeveloperViewEnabled("playground") === true
    const toPlayground = useMemo(
        () =>
            playgroundEnabled
                ? (row: AppRevisionRow) => playgroundHref(base, app.id, [row.revisionId])
                : null,
        [app.id, base, playgroundEnabled],
    )

    const groups = useMemo(() => toRevisionGroups(revisions.rows, mode), [revisions.rows, mode])
    const registryRows = useMemo(
        () => toRegistryRows(revisions.rows, mode, expanded),
        [revisions.rows, mode, expanded],
    )
    const navigationIds = useMemo(
        () =>
            betaDeveloperMode
                ? registryRows.map((row) => row.revision.revisionId)
                : visibleRevisionIds(groups, collapsed),
        [betaDeveloperMode, collapsed, groups, registryRows],
    )
    const openRow = useCallback(
        (row: AppRevisionRow) => setRevisionId(row.revisionId),
        [setRevisionId],
    )

    const changeMode = (next: string) => {
        const value = next === "variants" ? "variants" : "revisions"
        setMode(value)
        writeDisplayMode(value)
        // A variant row and a revision row are different things to select.
        setSelected(new Set())
    }
    const toggleVariant = (variantId: string) =>
        setExpanded((current) => {
            const next = new Set(current)
            if (!next.delete(variantId)) next.add(variantId)
            return next
        })
    const deleteRegistryRow = (row: RegistryRow) =>
        setDeletion(toDeletion([row], new Set([row.key])))
    const toDeploy = singleSelectedRevision(registryRows, selected)
    const toCompare = selectedPair(registryRows, selected)

    const shownRow = useShownRevisionRow({
        revisionId,
        appId: app.id,
        rows: revisions.rows,
    })

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

    const drawerActions = (
        <>
            {toPlayground && shownRow ? (
                <OpenInPlaygroundButton href={toPlayground(shownRow)} />
            ) : null}
            {canDeploy && shownRow ? (
                <Button size="sm" onClick={() => setDeployRow(shownRow)}>
                    <CloudArrowUp aria-hidden size={14} />
                    Deploy
                </Button>
            ) : null}
        </>
    )

    return (
        <>
            <ListTableToolbar
                search={search}
                onSearchChange={(next) => {
                    setSearch(next)
                    // Selected rows a new search hides would still be deleted: start over.
                    setSelected(new Set())
                }}
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
            {betaDeveloperMode ? (
                <RegistryTable
                    rows={registryRows}
                    isLoading={revisions.isPending}
                    latestRevisionId={latestRevisionId}
                    expanded={expanded}
                    onToggle={toggleVariant}
                    selection={{
                        selectedKeys: selected,
                        onChange: setSelected,
                        rowLabel: (row) =>
                            `Select ${row.revision.variantName} v${row.revision.version}`,
                        bulkActions: () => (
                            <>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!toCompare}
                                    title={
                                        toCompare ? undefined : "Select two revisions to compare"
                                    }
                                    onClick={() => toCompare && setComparing(toCompare)}
                                >
                                    <ArrowsLeftRight aria-hidden size={14} />
                                    Compare
                                </Button>
                                {canDeploy ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={!toDeploy}
                                        title={
                                            toDeploy ? undefined : "Select one revision to deploy"
                                        }
                                        onClick={() => toDeploy && setDeployRow(toDeploy)}
                                    >
                                        <CloudArrowUp aria-hidden size={14} />
                                        Deploy
                                    </Button>
                                ) : null}
                                {canDelete ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                            setDeletion(toDeletion(registryRows, selected))
                                        }
                                    >
                                        <Trash aria-hidden size={14} />
                                        Delete
                                    </Button>
                                ) : null}
                            </>
                        ),
                    }}
                    canDeploy={canDeploy}
                    canDelete={canDelete}
                    playgroundHref={toPlayground}
                    onOpen={openRow}
                    onDeploy={setDeployRow}
                    onDelete={deleteRegistryRow}
                    empty={empty}
                />
            ) : (
                <VariantsTable
                    groups={groups}
                    isLoading={revisions.isPending}
                    latestRevisionId={latestRevisionId}
                    canDeploy={canDeploy}
                    canDelete={canDelete}
                    playgroundHref={toPlayground}
                    collapsed={collapsed}
                    onCollapsedChange={setCollapsed}
                    onOpen={openRow}
                    onDeploy={setDeployRow}
                    onDelete={setDeleteRow}
                    empty={empty}
                />
            )}
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
                betaDeveloperMode ? (
                    <EditableRevisionDrawerHost
                        projectId={projectId}
                        kind="variant"
                        navigationIds={navigationIds}
                        actions={drawerActions}
                    />
                ) : (
                    <RevisionDrawerHost
                        kind="variant"
                        navigationIds={navigationIds}
                        actions={drawerActions}
                    />
                )
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
            {comparing ? (
                <CompareRevisionsDialog revisions={comparing} onClose={() => setComparing(null)} />
            ) : null}
            {deletion ? (
                <DeleteSelectionDialog
                    deletion={deletion}
                    projectId={projectId}
                    appId={app.id}
                    onClose={() => setDeletion(null)}
                    onDeleted={() => setSelected(new Set())}
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
