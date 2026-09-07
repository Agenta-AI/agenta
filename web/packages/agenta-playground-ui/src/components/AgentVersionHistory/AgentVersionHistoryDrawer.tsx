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

    const rows = useMemo(() => buildVersionRows(revisions), [revisions])
    const selectedIndex = rows.findIndex((row) => row.id === selectedId)
    const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null
    // Rows are newest first, so a version's predecessor is the row under it. That pair is the
    // diff: what THIS version changed, matching the message the list prints beside it.
    const previousRow = selectedIndex >= 0 ? (rows[selectedIndex + 1] ?? null) : null
    // The footer still counts from the latest — a revert mints the version after it.
    const latestRow = rows.find((row) => row.isLatest) ?? null

    const selectedParams = useAtomValue(
        workflowMolecule.selectors.serverConfiguration(selectedId || ""),
    )
    const previousParams = useAtomValue(
        workflowMolecule.selectors.serverConfiguration(previousRow?.id ?? ""),
    )
    // Only the button needs this: reverting to a version identical to the head does nothing.
    const latestParams = useAtomValue(workflowMolecule.selectors.configuration(latestRow?.id ?? ""))

    const selectedData = useAtomValue(workflowMolecule.selectors.serverData(selectedId || ""))
    const latestData = useAtomValue(workflowMolecule.selectors.data(latestRow?.id ?? ""))
    const selectedSchemas = selectedData?.data?.schemas
    const latestSchemas = latestData?.data?.schemas

    // Opens on the newest version — "what just changed" is the question the drawer is opened with.
    const selectVersionId = useSetAtom(versionHistorySelectedAtomFamily(workflowId))
    const newestId = rows[0]?.id ?? null
    useEffect(() => {
        if (open && !selectedId && newestId) selectVersionId(newestId)
    }, [open, selectedId, newestId, selectVersionId])

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

    // `local` is the selected version and `remote` its predecessor, so "added" reads as what this
    // version added — the same tense as the commit message on its row.
    const sections = useMemo(
        () =>
            selectedParams && previousParams
                ? classifyAgentChanges(selectedParams, previousParams)
                : [],
        [selectedParams, previousParams],
    )

    // Restoring a version whose configuration already matches the head does nothing, so the
    // BUTTON still measures against the latest even though the pane shows this version's own change.
    const matchesLatest = useMemo(
        () =>
            !!selectedParams &&
            !!latestParams &&
            stableStringify(selectedParams) === stableStringify(latestParams) &&
            stableStringify(selectedSchemas ?? {}) === stableStringify(latestSchemas ?? {}),
        [selectedParams, latestParams, selectedSchemas, latestSchemas],
    )
    const emptyText = !previousRow
        ? "The first version — there is nothing before it to compare."
        : "No configuration changes recorded in this version."

    const listLoading = query.isPending && revisions.length === 0
    const isError = query.isError && revisions.length === 0
    // A version whose config has not resolved is LOADING, not "unchanged" — an empty `sections`
    // means both, and only this tells them apart. The oldest row legitimately has no predecessor.
    const diffLoading =
        listLoading || (!!selectedId && !selectedParams) || (!!previousRow && !previousParams)
    const placeholder = isError
        ? "The version history could not be loaded. Retry from the list."
        : !selectedId
          ? "Pick a version to see what changed in it."
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
                    latestVersion={latestRow?.version ?? null}
                    disabled={!selectedRow || diffLoading || matchesLatest}
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
