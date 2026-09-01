/**
 * Version history for an agent: browse versions, see what each one would change against the
 * configuration on screen, and restore one.
 *
 * Restoring never rewrites history — it commits a new version holding the old content. The
 * engine for that lives in `@agenta/playground`; this file is the surface.
 *
 * Both hosts render it: the desktop playground header and the mobile session top bar, through the
 * shared `AgentRevisionStatus`. Below `sm` the two panes become one at a time — a phone has no
 * room for a 250px rail beside a diff.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {
    workflowMolecule,
    workflowRevisionsByWorkflowListDataAtomFamily,
    workflowRevisionsByWorkflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {classifyAgentChanges} from "@agenta/entities/workflow/commitDiff"
import {buildVersionRows, revertAgentRevisionAtom} from "@agenta/playground/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {cn, textColors} from "@agenta/ui/styles"
import {ArrowLeft} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {ChangesPane} from "./ChangesPane"
import {RevertFooter} from "./RevertFooter"
import {
    closeAgentVersionHistoryAtom,
    selectAgentVersionAtom,
    versionHistoryOpenAtomFamily,
    versionHistoryPhaseAtomFamily,
    versionHistoryRevertedFromAtomFamily,
    versionHistorySelectedAtomFamily,
} from "./store"
import {VersionList} from "./VersionList"

export interface AgentVersionHistoryDrawerProps {
    /** The workflow whose revisions are listed. */
    workflowId: string
    /** The revision under edit — the side every diff compares against, and revert commits from. */
    revisionId: string
}

export const AgentVersionHistoryDrawer = ({
    workflowId,
    revisionId,
}: AgentVersionHistoryDrawerProps) => {
    const open = useAtomValue(versionHistoryOpenAtomFamily(workflowId))
    const selectedId = useAtomValue(versionHistorySelectedAtomFamily(workflowId))
    const phase = useAtomValue(versionHistoryPhaseAtomFamily(workflowId))
    const revertedFrom = useAtomValue(versionHistoryRevertedFromAtomFamily(workflowId))
    const setPhase = useSetAtom(versionHistoryPhaseAtomFamily(workflowId))
    const setRevertedFrom = useSetAtom(versionHistoryRevertedFromAtomFamily(workflowId))
    const selectVersion = useSetAtom(selectAgentVersionAtom)
    const closeDrawer = useSetAtom(closeAgentVersionHistoryAtom)
    const revert = useSetAtom(revertAgentRevisionAtom)

    // Reading the query atom is what fetches; the list atom resolves the refs it primes.
    const query = useAtomValue(workflowRevisionsByWorkflowQueryAtomFamily(workflowId))
    const revisions = useAtomValue(workflowRevisionsByWorkflowListDataAtomFamily(workflowId))

    const rows = useMemo(() => buildVersionRows(revisions, revisionId), [revisions, revisionId])
    const selectedRow = rows.find((row) => row.id === selectedId) ?? null
    // The footer counts off the LATEST version: a revert mints the next one after it, which is
    // not `current + 1` when the surface happens to sit on an older revision.
    const latestRow = rows.find((row) => row.isLatest) ?? null

    const currentParams = useAtomValue(workflowMolecule.selectors.configuration(revisionId || ""))
    const selectedParams = useAtomValue(
        workflowMolecule.selectors.serverConfiguration(selectedId || ""),
    )

    // Open on the version below the latest — the latest is the comparison baseline, so it is not
    // selectable and would show an empty diff. Set directly, not through `handleSelect`, so a
    // phone still opens on the list rather than jumping to the diff.
    const selectVersionId = useSetAtom(versionHistorySelectedAtomFamily(workflowId))
    const firstComparableId = rows.find((row) => !row.isLatest)?.id ?? null
    useEffect(() => {
        if (open && !selectedId && firstComparableId) selectVersionId(firstComparableId)
    }, [open, selectedId, firstComparableId, selectVersionId])

    // Phone: one pane at a time. Picking a version pushes the diff; a back link returns.
    const [mobileView, setMobileView] = useState<"list" | "diff">("list")

    const handleSelect = useCallback(
        (id: string) => {
            selectVersion({workflowId, revisionId: id})
            setMobileView("diff")
        },
        [selectVersion, workflowId],
    )

    const handleConfirm = useCallback(async () => {
        if (!selectedRow) return
        setPhase("reverting")
        const landed = await revert({revisionId, targetRevisionId: selectedRow.id})
        if (landed) {
            setRevertedFrom(selectedRow.version)
            setPhase("done")
        } else {
            setPhase("failed")
        }
    }, [selectedRow, revert, revisionId, setPhase, setRevertedFrom])

    // `local` is the selected version and `remote` the current one, so "added" reads as what
    // restoring this version would bring back — the diff doubles as the revert preview.
    const sections = useMemo(
        () =>
            selectedParams && currentParams
                ? classifyAgentChanges(selectedParams, currentParams)
                : [],
        [selectedParams, currentParams],
    )

    const listLoading = query.isPending && revisions.length === 0
    const isError = query.isError && revisions.length === 0
    // A selected version whose config has not resolved is LOADING, not "identical" — an empty
    // `sections` means both, and only this tells them apart.
    const diffLoading = listLoading || (!!selectedId && !selectedParams)
    const placeholder = isError
        ? "The version history could not be loaded. Retry from the list."
        : rows.length <= 1
          ? "Nothing to compare yet — this agent has a single version."
          : !selectedId
            ? "Pick a version to see what restoring it would change."
            : undefined

    return (
        <EnhancedDrawer
            open={open}
            onClose={() => closeDrawer(workflowId)}
            title={<span className="text-sm font-normal">Version history</span>}
            width={780}
            classNames={{body: "!p-0"}}
            footer={
                <RevertFooter
                    phase={phase}
                    selectedVersion={selectedRow?.version ?? null}
                    currentVersion={latestRow?.version ?? null}
                    revertedFrom={revertedFrom}
                    disabled={!selectedRow || diffLoading || !sections.length}
                    onRequestConfirm={() => setPhase("confirm")}
                    onCancel={() => setPhase("idle")}
                    onConfirm={handleConfirm}
                    onClose={() => closeDrawer(workflowId)}
                />
            }
        >
            <div className="flex h-full min-h-0">
                <div
                    className={cn(
                        "flex min-h-0 flex-col py-3 pl-3 pr-2 sm:w-[250px] sm:shrink-0",
                        mobileView === "list" ? "w-full" : "hidden sm:flex",
                    )}
                >
                    <VersionList
                        rows={rows}
                        selectedId={selectedId}
                        isLoading={listLoading}
                        isError={isError}
                        onRetry={() => void query.refetch()}
                        onSelect={handleSelect}
                    />
                </div>

                <div
                    className={cn(
                        "flex min-w-0 flex-1 flex-col sm:border-0 sm:border-l sm:border-solid sm:border-[var(--ag-colorBorderSecondary)]",
                        mobileView === "diff" ? "flex" : "hidden sm:flex",
                    )}
                >
                    <button
                        type="button"
                        onClick={() => setMobileView("list")}
                        className={cn(
                            "flex cursor-pointer items-center gap-1.5 border-0 bg-transparent px-5 pt-3.5 text-xs sm:hidden",
                            textColors.secondary,
                        )}
                    >
                        <ArrowLeft />
                        Versions
                    </button>
                    <ChangesPane
                        sections={sections}
                        version={selectedRow?.version ?? null}
                        message={selectedRow?.message}
                        isLoading={diffLoading}
                        placeholder={placeholder}
                    />
                </div>
            </div>
        </EnhancedDrawer>
    )
}

export default AgentVersionHistoryDrawer
