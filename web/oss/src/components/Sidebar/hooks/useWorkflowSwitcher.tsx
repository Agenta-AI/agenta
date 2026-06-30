import {useCallback, useMemo, useState} from "react"

import {
    nonArchivedAppWorkflowsAtom,
    nonArchivedEvaluatorsAtom,
    nonHumanEvaluatorsAtom,
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

const EMPTY_WORKFLOWS: readonly Workflow[] = []

export const WORKFLOW_SWITCHER_MENU_CLASS = clsx(
    "max-h-80 overflow-y-auto !pt-0",
    "[&_.ant-dropdown-menu-item-group-title]:sticky",
    "[&_.ant-dropdown-menu-item-group-title]:top-0",
    "[&_.ant-dropdown-menu-item-group-title]:z-10",
    "[&_.ant-dropdown-menu-item-group-title]:!bg-[var(--ant-color-bg-elevated)]",
    "[&_.ant-dropdown-menu-item-group-title]:!text-[var(--ant-color-text-secondary)]",
    "[&_.ant-dropdown-menu-item-group-title]:!pb-2",
)

export const useWorkflowSwitcher = () => {
    const context = useAtomValue(currentWorkflowContextAtom)
    const apps = useAtomValue(nonArchivedAppWorkflowsAtom) as readonly Workflow[]
    const evaluators = useAtomValue(nonArchivedEvaluatorsAtom) as readonly Workflow[]
    const automaticEvaluators = useAtomValue(nonHumanEvaluatorsAtom) as readonly Workflow[]
    const recentAppId = useAtomValue(recentAppIdAtom)
    const recentEvaluatorId = useAtomValue(recentEvaluatorIdAtom)
    const navigateToWorkflow = useSetAtom(routerAppNavigationAtom)
    const [open, setOpen] = useState(false)

    const switcherEvaluators = EVALUATOR_FULL_PAGE_NAV_ENABLED
        ? automaticEvaluators
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
    const isEvaluator = workflowId
        ? evaluators.some((evaluator) => evaluator.id === workflowId)
        : context.workflowKind === "evaluator"

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
            ...apps.map((entity) => toMenuItem(entity, false)),
            ...switcherEvaluators.map((entity) => toMenuItem(entity, true)),
        ]

        return children.length
            ? [{key: "workflows-header", type: "group", label: "", children}]
            : []
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
