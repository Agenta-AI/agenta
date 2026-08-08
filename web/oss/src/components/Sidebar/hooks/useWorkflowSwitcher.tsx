import {useCallback, useMemo, useState} from "react"

import type {WorkflowPickerEntry} from "@agenta/navigation-ui"
import {
    nonArchivedAppWorkflowsAtom,
    nonArchivedEvaluatorsAtom,
    nonDeterministicEvaluatorsAtom,
    type Workflow,
} from "@agenta/entities/workflow"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {
    appSwitchHrefAtom,
    recentAppIdAtom,
    routerAppNavigationAtom,
} from "@/oss/state/app/atoms/fetcher"
import {
    currentWorkflowContextAtom,
    EVALUATOR_FULL_PAGE_NAV_ENABLED,
    recentEvaluatorIdAtom,
} from "@/oss/state/workflow"

import {resolveWorkflowEntitySelection} from "../components/assets/workflowEntitySelection"
import WorkflowIdentity from "../components/WorkflowIdentity"

import {resolveIsEvaluatorWorkflow} from "./workflowSwitcherHelpers"

const EMPTY_WORKFLOWS: readonly Workflow[] = []
// Stable empty atom read while the switcher is dormant, so the apps/evaluator
// list atoms (and the evaluator latest-revision fan-out behind them) stay
// unsubscribed until the switcher is first opened.
const EMPTY_WORKFLOWS_ATOM = atom<readonly Workflow[]>(EMPTY_WORKFLOWS)

const getWorkflowActivityTime = (workflow: Workflow) => {
    const timestamp = workflow.updated_at ?? workflow.created_at
    if (!timestamp) return 0

    const parsedTimestamp = Date.parse(timestamp)
    return Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp
}

export const useWorkflowSwitcher = () => {
    const context = useAtomValue(currentWorkflowContextAtom)
    const [open, setOpenState] = useState(false)
    // Latch: flips true on first switcher-open and never resets, so the full
    // apps/evaluators catalogs (and the evaluator revision fan-out) resolve
    // LAZILY on open instead of on every sidebar mount, then stay warm.
    const [switcherActivated, setSwitcherActivated] = useState(false)
    const setOpen = useCallback((next: boolean) => {
        setOpenState(next)
        if (next) setSwitcherActivated(true)
    }, [])

    // The full apps + evaluators lists are needed only to populate the switcher
    // (once opened) or to resolve the recent-workflow fallback on a route that
    // points at NO workflow (e.g. /home). On a workflow route with the switcher
    // closed we need neither, so we read stable empty atoms to avoid pulling the
    // whole apps/evaluator catalogs on every page load. Gate on `workflowId` (the
    // URL id, truthy from the first render), NOT on `workflow` (null while
    // resolution is in flight, which would still fire the catalogs).
    const wantWorkflowLists = !context.workflowId || switcherActivated
    const apps = useAtomValue(
        wantWorkflowLists ? nonArchivedAppWorkflowsAtom : EMPTY_WORKFLOWS_ATOM,
    ) as readonly Workflow[]
    const evaluators = useAtomValue(
        wantWorkflowLists ? nonArchivedEvaluatorsAtom : EMPTY_WORKFLOWS_ATOM,
    ) as readonly Workflow[]
    const recentAppId = useAtomValue(recentAppIdAtom)
    const recentEvaluatorId = useAtomValue(recentEvaluatorIdAtom)
    const navigateToWorkflow = useSetAtom(routerAppNavigationAtom)
    const buildWorkflowHref = useAtomValue(appSwitchHrefAtom)

    // Product decision: the workflow switcher is intentionally narrower than
    // full-page routing. It includes non-deterministic automatic evaluators
    // (LLM/code/hook/online-capable), but not deterministic matchers or humans.
    // LAZY: reading `nonDeterministicEvaluatorsAtom` fans out one batched
    // POST /workflows/revisions/query over every evaluator, and it's only needed
    // to populate the switcher dropdown — so subscribe to it only once opened.
    const switcherEvaluators = useAtomValue(
        EVALUATOR_FULL_PAGE_NAV_ENABLED && switcherActivated
            ? nonDeterministicEvaluatorsAtom
            : EMPTY_WORKFLOWS_ATOM,
    ) as readonly Workflow[]

    const workflow = useMemo<Workflow | null>(() => {
        if (context.workflow) return context.workflow
        // While the URL's own workflow is still resolving, do NOT substitute a
        // stale recent workflow: on an app route the recent entry is often a
        // recent EVALUATOR, and flashing its tag fires the evaluator catalog for
        // a card about to swap to the app's own type. Waiting one tick avoids it.
        if (context.isResolving) return null
        return resolveWorkflowEntitySelection({
            currentWorkflow: context.workflow,
            currentWorkflowId: context.workflowId,
            apps,
            evaluators,
            recentAppId,
            recentEvaluatorId,
        })
    }, [
        apps,
        context.workflow,
        context.workflowId,
        context.isResolving,
        evaluators,
        recentAppId,
        recentEvaluatorId,
    ])

    const workflowId = workflow?.id ?? null
    const displayName = workflow?.name ?? workflow?.slug ?? workflowId ?? "Select workflow"
    const isEvaluator = resolveIsEvaluatorWorkflow({
        workflowId,
        workflowKind: context.workflowKind,
        evaluators,
    })

    const entries = useMemo<WorkflowPickerEntry[]>(() => {
        const toEntry = (entity: Workflow, isEvaluator: boolean): WorkflowPickerEntry => {
            const label = entity.name ?? entity.slug ?? entity.id
            return {
                key: entity.id,
                href: buildWorkflowHref(entity.id),
                content: (
                    <WorkflowIdentity
                        workflowId={entity.id}
                        name={label}
                        isEvaluator={isEvaluator}
                        selected={entity.id === workflowId}
                    />
                ),
            }
        }
        return [
            ...apps.map((entity) => ({entity, isEvaluator: false})),
            ...switcherEvaluators.map((entity) => ({entity, isEvaluator: true})),
        ]
            .sort(
                (left, right) =>
                    getWorkflowActivityTime(right.entity) - getWorkflowActivityTime(left.entity),
            )
            .map(({entity, isEvaluator}) => toEntry(entity, isEvaluator))
    }, [apps, buildWorkflowHref, switcherEvaluators, workflowId])

    const handleSelect = useCallback(
        (key: string) => {
            setOpen(false)
            if (key && key !== workflowId) navigateToWorkflow(key)
        },
        [navigateToWorkflow, setOpen, workflowId],
    )

    return {
        displayName,
        entries,
        handleSelect,
        open,
        setOpen,
        isEvaluator,
        workflow,
        workflowId,
    }
}
