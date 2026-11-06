import {useCallback, useEffect, useRef, useState} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {
    discardLocalServerDataAtom,
    getWorkflowCommitCallbacks,
    registerWorkflowCommitCallbacks,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {cn} from "@agenta/ui/styles"
import {Button, Sheet, SheetContent, SheetHeader} from "@agenta/ui/ui"
import {ArrowsIn, ArrowsOut, CaretDownIcon, CaretUpIcon} from "@phosphor-icons/react"
import {atom, useStore} from "jotai"

import {DiscardChangesDialog} from "./DiscardChangesDialog"
import {DrawerTitle} from "./DrawerTitle"
import {EditableRevisionDrawerBody} from "./EditableRevisionDrawerBody"
import type {EditableRevisionDrawerProps} from "./types"

/**
 * Edits that a close or a switch would lose: a changed revision, or a local copy of a saved one.
 * A new entity made from a template counts only once it is changed.
 */
export const drawerHasUnsavedEditsAtom = atom((get) =>
    get(playgroundController.selectors.nodes()).some(({entityId}) => {
        if (get(workflowMolecule.selectors.isDirty(entityId))) return true
        return isLocalDraftId(entityId) && !get(workflowMolecule.selectors.isEphemeral(entityId))
    }),
)

type Pending = {kind: "close"} | {kind: "navigate"; revisionId: string}

/**
 * One workflow revision in a right-side drawer that edits it: the config with Commit (Create for
 * an unsaved local revision), the details, and Test, which shows the host's test pane beside the
 * config. The host owns the open state, the URL and every other write (Deploy, Revert).
 *
 * The drawer owns the playground state while it is open (see `useDrawerPlaygroundSession`).
 */
export const EditableRevisionDrawer = ({
    revisionId,
    kind,
    onClose,
    navigationIds = [],
    onNavigate,
    actions,
    configActions,
    renderRuns,
    canCommit = true,
    canDeploy = false,
    onCommitted,
    onRefinePrompt,
    defaultTesting = false,
}: EditableRevisionDrawerProps) => {
    const store = useStore()
    // The revision a commit just made. The drawer shows it from inside the commit, before the
    // commit clears the draft it came from: shown any later (when the host passes it back), the
    // form first draws the old revision without the edits and keeps that text after the switch.
    const [committedId, setCommittedId] = useState<string | null>(null)
    // Keep the last revision drawn while the sheet slides out after a close.
    const shownIdRef = useRef(revisionId)
    if (revisionId) shownIdRef.current = revisionId
    const shownId = committedId ?? shownIdRef.current
    if (committedId && revisionId === committedId) setCommittedId(null)
    const currentIdRef = useRef(shownId)
    currentIdRef.current = shownId

    // The commit callback is one slot for the app: keep the one before and put it back on close.
    useEffect(() => {
        const previous = getWorkflowCommitCallbacks().onNewRevision
        registerWorkflowCommitCallbacks({
            onNewRevision: async (result, params) => {
                if (result.revisionId === currentIdRef.current) {
                    setCommittedId(result.newRevisionId)
                }
                await previous?.(result, params)
            },
        })
        return () => registerWorkflowCommitCallbacks({onNewRevision: previous})
    }, [])
    const [testing, setTesting] = useState(defaultTesting)
    const [pending, setPending] = useState<Pending | null>(null)

    const index = shownId ? navigationIds.indexOf(shownId) : -1
    const previousId = index > 0 ? navigationIds[index - 1] : undefined
    const nextId = index >= 0 ? navigationIds[index + 1] : undefined

    const act = useCallback(
        (next: Pending) => {
            if (next.kind === "close") {
                onClose()
                return
            }
            // The edits of the revision being left go, as they would on a close.
            if (shownId) {
                if (isLocalDraftId(shownId)) store.set(discardLocalServerDataAtom, shownId)
                else store.set(workflowMolecule.actions.discard, shownId)
            }
            onNavigate?.(next.revisionId)
        },
        [onClose, onNavigate, shownId, store],
    )

    const request = useCallback(
        (next: Pending) => {
            if (store.get(drawerHasUnsavedEditsAtom)) setPending(next)
            else act(next)
        },
        [act, store],
    )

    const testLabel = kind === "evaluator" ? "Test evaluator" : "Test app"

    return (
        <>
            <Sheet
                open={revisionId !== null}
                onOpenChange={(open) => (open ? undefined : request({kind: "close"}))}
            >
                <SheetContent
                    side="right"
                    aria-describedby={undefined}
                    data-testid="editable-revision-drawer"
                    className={cn(
                        "overflow-hidden max-sm:inset-0 max-sm:w-full max-sm:rounded-none sm:max-w-none",
                        testing ? "sm:w-[min(1600px,94vw)]" : "sm:w-[min(1100px,92vw)]",
                    )}
                >
                    {shownId ? (
                        <>
                            <SheetHeader className="border-0 border-b border-solid border-border py-2.5">
                                {/* On a phone the title takes its own row above the buttons. */}
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <div className="min-w-0 max-sm:basis-full sm:flex-1">
                                        <DrawerTitle revisionId={shownId} kind={kind} />
                                    </div>
                                    {navigationIds.length > 1 ? (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label="Previous revision"
                                                disabled={!previousId}
                                                onClick={() =>
                                                    previousId &&
                                                    request({
                                                        kind: "navigate",
                                                        revisionId: previousId,
                                                    })
                                                }
                                            >
                                                <CaretUpIcon />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label="Next revision"
                                                disabled={!nextId}
                                                onClick={() =>
                                                    nextId &&
                                                    request({kind: "navigate", revisionId: nextId})
                                                }
                                            >
                                                <CaretDownIcon />
                                            </Button>
                                        </>
                                    ) : null}
                                    {actions}
                                    <Button
                                        variant={testing ? "secondary" : "outline"}
                                        size="sm"
                                        aria-pressed={testing}
                                        onClick={() => setTesting((on) => !on)}
                                    >
                                        {testing ? (
                                            <ArrowsIn aria-hidden size={14} />
                                        ) : (
                                            <ArrowsOut aria-hidden size={14} />
                                        )}
                                        {testLabel}
                                    </Button>
                                </div>
                            </SheetHeader>
                            <EditableRevisionDrawerBody
                                revisionId={shownId}
                                kind={kind}
                                testing={testing}
                                canCommit={canCommit}
                                canDeploy={canDeploy}
                                configActions={configActions}
                                renderRuns={renderRuns}
                                onRefinePrompt={onRefinePrompt}
                                onCommitted={(newRevisionId) =>
                                    onCommitted?.(shownId, newRevisionId)
                                }
                            />
                        </>
                    ) : null}
                </SheetContent>
            </Sheet>
            <DiscardChangesDialog
                open={pending !== null}
                onCancel={() => setPending(null)}
                onDiscard={() => {
                    const next = pending
                    setPending(null)
                    if (next) act(next)
                }}
            />
        </>
    )
}
