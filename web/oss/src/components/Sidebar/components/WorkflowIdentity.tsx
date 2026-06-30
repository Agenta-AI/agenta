import {memo, type ComponentType} from "react"

import {workflowAppTypeAtomFamily} from "@agenta/entities/workflow"
import {Check, Gavel, RobotIcon, SquaresFour, type IconProps} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue} from "jotai"

type WorkflowDisplayType = "agent" | "prompt" | "evaluator"

const WORKFLOW_DISPLAY_META: Record<
    WorkflowDisplayType,
    {label: string; Icon: ComponentType<IconProps>; className: string}
> = {
    agent: {
        label: "Agent",
        Icon: RobotIcon,
        className: "bg-[var(--ant-purple-1)] text-[var(--ant-purple-6)]",
    },
    prompt: {
        label: "Prompt",
        Icon: SquaresFour,
        className: "bg-[var(--ant-blue-1)] text-[var(--ant-blue-6)]",
    },
    evaluator: {
        label: "Evaluator",
        Icon: Gavel,
        className: "bg-[var(--ant-orange-1)] text-[var(--ant-orange-6)]",
    },
}

interface WorkflowIdentityViewProps {
    displayType: WorkflowDisplayType
    name: string
    selected?: boolean
    showDetails?: boolean
}

const WorkflowIdentityView = ({
    displayType,
    name,
    selected,
    showDetails = true,
}: WorkflowIdentityViewProps) => {
    const {Icon, className, label} = WORKFLOW_DISPLAY_META[displayType]

    return (
        <div
            className={clsx(
                "flex min-w-0 w-full items-center transition-[gap] duration-300 ease-in-out",
                showDetails ? "gap-2" : "gap-0",
            )}
        >
            <span
                className={clsx(
                    "flex shrink-0 items-center justify-center transition-[width,height,border-radius] duration-300 ease-in-out",
                    showDetails ? "h-8 w-8 rounded-lg" : "h-6 w-6 rounded-md",
                    className,
                )}
            >
                <Icon size={showDetails ? 17 : 14} />
            </span>
            <div
                className={clsx(
                    "flex min-w-0 flex-1 flex-col overflow-hidden text-left transition-[max-width,opacity] duration-300 ease-in-out",
                    showDetails ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0",
                )}
                aria-hidden={!showDetails}
            >
                <span className="truncate leading-5" title={name}>
                    {name}
                </span>
                <span className="text-[10px] leading-3 text-colorTextTertiary">{label}</span>
            </div>
            {selected && <Check size={16} className="shrink-0" />}
        </div>
    )
}

const AppWorkflowIdentity = ({
    workflowId,
    ...props
}: Omit<WorkflowIdentityViewProps, "displayType"> & {workflowId: string}) => {
    const appType = useAtomValue(workflowAppTypeAtomFamily(workflowId))

    return (
        <WorkflowIdentityView {...props} displayType={appType === "agent" ? "agent" : "prompt"} />
    )
}

interface WorkflowIdentityProps {
    workflowId: string | null
    name: string
    isEvaluator: boolean
    selected?: boolean
    showDetails?: boolean
}

const WorkflowIdentity = memo(
    ({workflowId, name, isEvaluator, selected, showDetails}: WorkflowIdentityProps) => {
        if (isEvaluator) {
            return (
                <WorkflowIdentityView
                    displayType="evaluator"
                    name={name}
                    selected={selected}
                    showDetails={showDetails}
                />
            )
        }

        if (workflowId) {
            return (
                <AppWorkflowIdentity
                    workflowId={workflowId}
                    name={name}
                    selected={selected}
                    showDetails={showDetails}
                />
            )
        }

        return (
            <WorkflowIdentityView
                displayType="prompt"
                name={name}
                selected={selected}
                showDetails={showDetails}
            />
        )
    },
)

WorkflowIdentity.displayName = "WorkflowIdentity"

export default WorkflowIdentity
