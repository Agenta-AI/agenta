import {useCallback, useMemo, useState} from "react"

import {
    nonArchivedAppWorkflowsAtom,
    nonArchivedEvaluatorsAtom,
    nonDeterministicEvaluatorsAtom,
    type Workflow,
} from "@agenta/entities/workflow"
import type {MenuProps} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {recentAppIdAtom, routerAppNavigationAtom} from "@/oss/state/app/atoms/fetcher"
import {
    currentWorkflowContextAtom,
    EVALUATOR_FULL_PAGE_NAV_ENABLED,
    recentEvaluatorIdAtom,
} from "@/oss/state/workflow"

import {resolveWorkflowEntitySelection} from "../components/assets/workflowEntitySelection"
import WorkflowIdentity from "../components/WorkflowIdentity"

import {resolveIsEvaluatorWorkflow} from "./workflowSwitcherHelpers"

const EMPTY_WORKFLOWS: readonly Workflow[] = []

const getWorkflowActivityTime = (workflow: Workflow) => {
    const timestamp = workflow.updated_at ?? workflow.created_at
    if (!timestamp) return 0

    const parsedTimestamp = Date.parse(timestamp)
    return Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp
}

export const WORKFLOW_SWITCHER_MENU_CLASS = clsx(
    "max-h-80 overflow-y-auto !py-2 !px-2",
    "[&_.ant-dropdown-menu-item]:!px-2",
)

export const useWorkflowSwitcher = () => {
    const context = useAtomValue(currentWorkflowContextAtom)
    const apps = useAtomValue(nonArchivedAppWorkflowsAtom) as readonly Workflow[]
    const evaluators = useAtomValue(nonArchivedEvaluatorsAtom) as readonly Workflow[]
    const nonDeterministicEvaluators = useAtomValue(
        nonDeterministicEvaluatorsAtom,
    ) as readonly Workflow[]
    const recentAppId = useAtomValue(recentAppIdAtom)
    const recentEvaluatorId = useAtomValue(recentEvaluatorIdAtom)
    const navigateToWorkflow = useSetAtom(routerAppNavigationAtom)
    const [open, setOpen] = useState(false)

    // Product decision: the workflow switcher is intentionally narrower than
    // full-page routing. It includes non-deterministic automatic evaluators
    // (LLM/code/hook/online-capable), but not deterministic matchers or humans.
    const switcherEvaluators = EVALUATOR_FULL_PAGE_NAV_ENABLED
        ? nonDeterministicEvaluators
        : EMPTY_WORKFLOWS

    const workflow = useMemo<Workflow | null>(
        () =>
            resolveWorkflowEntitySelection({
                currentWorkflow: context.workflow,
                currentWorkflowId: context.workflowId,
                apps,
                evaluators,
                recentAppId,
                recentEvaluatorId,
            }),
        [apps, context.workflow, context.workflowId, evaluators, recentAppId, recentEvaluatorId],
    )

    const workflowId = workflow?.id ?? null
    const displayName = workflow?.name ?? workflow?.slug ?? workflowId ?? "Select workflow"
    const isEvaluator = resolveIsEvaluatorWorkflow({
        workflowId,
        workflowKind: context.workflowKind,
        evaluators,
    })

    const menuItems = useMemo<MenuProps["items"]>(() => {
        const toMenuItem = (entity: Workflow, isEvaluator: boolean) => {
            const label = entity.name ?? entity.slug ?? entity.id
            return {
                key: entity.id,
                label: (
                    <WorkflowIdentity
                        workflowId={entity.id}
                        name={label}
                        isEvaluator={isEvaluator}
                        selected={entity.id === workflowId}
                    />
                ),
            }
        }
        const children = [
            ...apps.map((entity) => ({entity, isEvaluator: false})),
            ...switcherEvaluators.map((entity) => ({entity, isEvaluator: true})),
        ]
            .sort(
                (left, right) =>
                    getWorkflowActivityTime(right.entity) - getWorkflowActivityTime(left.entity),
            )
            .map(({entity, isEvaluator}) => toMenuItem(entity, isEvaluator))

        return children
    }, [apps, switcherEvaluators, workflowId])

    const handleMenuClick = useCallback<NonNullable<MenuProps["onClick"]>>(
        ({key}) => {
            setOpen(false)
            if (key && key !== workflowId) navigateToWorkflow(key)
        },
        [navigateToWorkflow, workflowId],
    )

    return {
        displayName,
        handleMenuClick,
        menuItems,
        open,
        selectedKeys: workflowId ? [workflowId] : undefined,
        setOpen,
        isEvaluator,
        workflow,
        workflowId,
    }
}
