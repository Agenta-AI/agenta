import {useCallback, useMemo} from "react"

import {buildAutomationEdit} from "./automationEdit"
import {agentLabel} from "./automationModel"
import {useAutomation} from "./useAutomation"
import {useAutomationDraft} from "./useAutomationDraft"
import {useAutomationRuns} from "./useAutomationRuns"
import {useAutomations} from "./useAutomations"

/**
 * One saved automation, ready to edit — the composition every host needs and none should repeat.
 *
 * The kind is resolved from the two lists rather than threaded in from whatever was clicked: an
 * id is all a link (or a drawer atom) carries, and both endpoints have to be searched to know
 * which one owns it. The listed row also stands in while the single-entity fetch is in flight,
 * so the surface is readable before it lands.
 *
 * The config fields are one unsaved draft that leaves on Save; the name and the on/off switch
 * still write on the spot, because neither is a change you would want to stage.
 */
export const useAutomationEditor = (automationId: string | undefined) => {
    const {
        automations,
        isLoading: listLoading,
        agentNames,
        agentsReady,
        resolveAgentId,
    } = useAutomations()
    const listed = useMemo(
        () => automations.find((candidate) => candidate.id === automationId),
        [automations, automationId],
    )
    // The entity fetch waits on the kind — until then the hook is inert and the row stands in.
    const {
        automation: fetched,
        edit,
        setActive,
    } = useAutomation(listed ? automationId : undefined, listed?.kind ?? "schedule")
    // The fetched row comes straight off the endpoint, so its binding is resolved here the way
    // the list's was. Nothing is handed out until the agents can be named: the draft seeds its
    // baseline from this row, and a baseline that still holds a variant id would turn the next
    // Save into a rebind to that variant once the real workflow id arrived underneath it.
    const automation = useMemo(() => {
        if (!agentsReady) return null
        return fetched ? {...fetched, agentId: resolveAgentId(fetched.agentId)} : (listed ?? null)
    }, [agentsReady, fetched, listed, resolveAgentId])

    const draft = useAutomationDraft(automation, edit)

    // The runs answer two questions a host asks: how many there have been, and whether the last
    // one failed. Same hook and same cache the run history reads.
    const {caption: runHistoryCaption, failureReason} = useAutomationRuns(automation)

    // The DRAFT's agent, not the saved one: the field has to name what a Save would bind.
    const agentName = useMemo(
        () =>
            agentLabel(
                draft.preview?.agentId ?? null,
                agentNames.get(draft.preview?.agentId ?? "")?.trim() || null,
                agentsReady,
            ),
        [agentNames, agentsReady, draft.preview?.agentId],
    )

    const onRename = useCallback(
        async (name: string) => {
            if (!automation) return false
            return !!(await edit(buildAutomationEdit(automation, {name})))
        },
        [automation, edit],
    )

    // The toggle's own control owns the messages and the spinner; it only needs this to settle.
    const onToggle = useCallback(
        async (next: boolean) => {
            if (!automation) return
            await setActive(automation.id, next)
        },
        [automation, setActive],
    )

    return {
        automation,
        agentName,
        runHistoryCaption,
        failureReason,
        /** Neither the list nor the entity has it — the id is stale. */
        missing: !automation && !listLoading && agentsReady,
        loading: !automation && (listLoading || !agentsReady),
        onRename,
        onToggle,
        ...draft,
    }
}
