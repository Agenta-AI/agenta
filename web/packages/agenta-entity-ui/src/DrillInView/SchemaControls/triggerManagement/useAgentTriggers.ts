/** Agent scoping for the Triggers section: matchable ids, default-bind refs, scoped lists. */
import {useMemo} from "react"

import {
    useTriggerSchedules,
    useTriggerSubscriptions,
    type TriggerReference,
} from "@agenta/entities/gatewayTrigger"
import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

/** Whether any id in a trigger's `data.references` matches one of the agent's ids. */
function referencesMatch(
    references: Record<string, TriggerReference> | null | undefined,
    agentIds: Set<string>,
): boolean {
    if (!references || agentIds.size === 0) return false
    for (const ref of Object.values(references)) {
        if (ref?.id && agentIds.has(ref.id)) return true
    }
    return false
}

/**
 * Resolve the agent's matchable ids, its `defaultReferences`, and the project triggers
 * scoped to it. Shared by the section body and the header count badge / add-dropdown in
 * {@link AgentConfigControl} so scoping is defined in exactly one place.
 */
export function useAgentTriggers(entityId: string | null) {
    // The drill-in entity only carries `parameters`; read the parent ids straight from
    // the workflow molecule (keyed by the revision id, which is the entityId).
    // Narrowed to the four fields used — a whole-resolvedData subscription re-renders the
    // config panel on every boot-time data resolution.
    const revisionMeta = useAtomValue(
        useMemo(
            () =>
                selectAtom(
                    workflowMolecule.selectors.resolvedData(entityId ?? ""),
                    (revision) => ({
                        appId: revision?.workflow_id ?? null,
                        variantId: revision?.workflow_variant_id ?? revision?.variant_id ?? null,
                        appSlug: (revision as {slug?: string} | null)?.slug ?? null,
                    }),
                    (a, b) =>
                        a.appId === b.appId &&
                        a.variantId === b.variantId &&
                        a.appSlug === b.appSlug,
                ),
            [entityId],
        ),
    )
    const appId = revisionMeta.appId
    const variantId = revisionMeta.variantId
    // The app slug — needed for "By environment" binding, which resolves via the
    // application slug + environment (see triggers/service.py `_normalize_references`).
    const appSlug = revisionMeta.appSlug
    // Readable label for the default binding so the drawer's bound-workflow field shows the
    // agent's name instead of a raw id. The display name lives on the workflow ARTIFACT, not
    // on the revision. Falls back when it is unresolved.
    const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(entityId ?? ""))
    const defaultBoundLabel = artifactName ?? "Current agent"

    const agentIds = useMemo(() => {
        const ids = new Set<string>()
        if (entityId) ids.add(entityId)
        if (appId) ids.add(appId)
        if (variantId) ids.add(variantId)
        return ids
    }, [entityId, appId, variantId])

    // Pre-bind any trigger created from this section to the current agent. The drawers
    // store the picker's leaf id under `application_variant` (the BE completes the
    // family), so use the variant id when known, else the revision id.
    const defaultReferences = useMemo(() => {
        const refs: Record<string, {id?: string; slug?: string}> = {}
        if (appId || appSlug) {
            refs.application = {...(appId ? {id: appId} : {}), ...(appSlug ? {slug: appSlug} : {})}
        }
        const variantRef = variantId ?? entityId
        if (variantRef) refs.application_variant = {id: variantRef}
        return refs
    }, [appId, appSlug, variantId, entityId])

    const {subscriptions} = useTriggerSubscriptions()
    const {schedules} = useTriggerSchedules()

    const scopedSubscriptions = useMemo(
        () => subscriptions.filter((s) => referencesMatch(s.data?.references, agentIds)),
        [subscriptions, agentIds],
    )
    const scopedSchedules = useMemo(
        () => schedules.filter((s) => referencesMatch(s.data?.references, agentIds)),
        [schedules, agentIds],
    )

    return {
        defaultReferences,
        defaultBoundLabel,
        scopedSubscriptions,
        scopedSchedules,
        count: scopedSubscriptions.length + scopedSchedules.length,
    }
}
