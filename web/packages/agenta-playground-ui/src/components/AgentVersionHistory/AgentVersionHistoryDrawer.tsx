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
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    workflowMolecule,
    workflowRevisionsByWorkflowListDataAtomFamily,
    workflowRevisionsByWorkflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {classifyAgentChanges, stableStringify} from "@agenta/entities/workflow/commitDiff"
import {buildVersionRows, revertAgentRevisionAtom} from "@agenta/playground/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {cn, textColors} from "@agenta/ui/styles"
import {ArrowLeft} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {ChangesPane} from "./ChangesPane"
import {RevertFooter} from "./RevertFooter"
import type {RevertPhase} from "./RevertFooter"
import {
    closeAgentVersionHistoryAtom,
    selectAgentVersionAtom,
    versionHistoryOpenAtomFamily,
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

    // Opens below the latest; set directly so a phone still lands on the list, not the diff.
    const selectVersionId = useSetAtom(versionHistorySelectedAtomFamily(workflowId))
    const firstComparableId = rows.find((row) => !row.isLatest)?.id ?? null
    useEffect(() => {
        if (open && !selectedId && firstComparableId) selectVersionId(firstComparableId)
    }, [open, selectedId, firstComparableId, selectVersionId])

    // Drawer-local: nothing outside reads either.
    const [phase, setPhase] = useState<RevertPhase>("idle")
    // Phone: one pane at a time. Picking a version pushes the diff; a back link returns.
    const [mobileView, setMobileView] = useState<"list" | "diff">("list")

    // Bumped whenever the flow is abandoned, so a revert that resolves afterwards knows its
    // result is stale. Escape and outside-click dismiss the drawer, so a commit can outlive it.
    const revertRun = useRef(0)

    // The drawer stays mounted so it can animate out, so closing must reset its own state.
    const handleClose = useCallback(() => {
        revertRun.current += 1
        closeDrawer(workflowId)
        setPhase("idle")
        setMobileView("list")
    }, [closeDrawer, workflowId])

    const handleSelect = useCallback(
        (id: string) => {
            revertRun.current += 1
            selectVersion({workflowId, revisionId: id})
            setPhase("idle")
            setMobileView("diff")
        },
        [selectVersion, workflowId],
    )

    const handleConfirm = useCallback(async () => {
        if (!selectedRow) return
        const run = ++revertRun.current
        setPhase("reverting")
        const landed = await revert({revisionId, targetRevisionId: selectedRow.id})
        // Closed or moved on while the commit was in flight: the outcome is no longer this
        // drawer's to report. The revision itself still landed either way.
        if (run !== revertRun.current) return
        setPhase(landed ? "done" : "failed")
    }, [selectedRow, revert, revisionId])

    // `local` is the selected version and `remote` the current one, so "added" reads as what
    // restoring this version would bring back — the diff doubles as the revert preview.
    const sections = useMemo(
        () =>
            selectedParams && currentParams
                ? classifyAgentChanges(selectedParams, currentParams)
                : [],
        [selectedParams, currentParams],
    )

    // An empty `sections` is not proof the configs match — the classifier only surfaces what it
    // recognises. Compare the stored objects so an unclassified difference stays restorable.
    const identical = useMemo(
        () =>
            !!selectedParams &&
            !!currentParams &&
            stableStringify(selectedParams) === stableStringify(currentParams),
        [selectedParams, currentParams],
    )
    const isCurrentRevision = !!selectedId && selectedId === revisionId
    const emptyText = isCurrentRevision
        ? "This is the version you are on."
        : identical
          ? "Identical to your current configuration — restoring it would change nothing."
          : "This version differs, but not in anything the summary can describe. Restoring it still applies the stored configuration."

    const listLoading = query.isPending && revisions.length === 0
    const isError = query.isError && revisions.length === 0
    // A selected version whose config has not resolved is LOADING, not "identical" — an empty
    // `sections` means both, and only this tells them apart.
    const diffLoading = listLoading || (!!selectedId && (!selectedParams || !currentParams))
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
            onClose={handleClose}
            title={<span className="text-sm font-normal">Version history</span>}
            width={780}
            // px-3 so the buttons' outer edge lands on the same line as the section bands.
            classNames={{body: "!p-0", footer: "px-3"}}
            footer={
                <RevertFooter
                    phase={phase}
                    selectedVersion={selectedRow?.version ?? null}
                    currentVersion={latestRow?.version ?? null}
                    disabled={!selectedRow || diffLoading || identical || isCurrentRevision}
                    onRequestConfirm={() => setPhase("confirm")}
                    onCancel={() => setPhase("idle")}
                    onConfirm={handleConfirm}
                    onClose={handleClose}
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
                        disabled={phase === "reverting"}
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
                        emptyText={emptyText}
                    />
                </div>
            </div>
        </EnhancedDrawer>
    )
}

export default AgentVersionHistoryDrawer
