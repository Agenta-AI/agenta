import {memo, type ComponentType, type CSSProperties, type ReactNode} from "react"

import {workflowAppTypeAtomFamily} from "@agenta/entities/workflow"
import {useAgentIconChrome} from "@agenta/entity-ui/agent"
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
        // Recolor spec: the olive accent chip in dark, the Agent tag pair in light.
        className:
            "bg-[#E5F1F9] text-[#113955] dark:bg-[rgba(209,209,81,0.15)] dark:text-[#D1D151]",
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
    /** The agent's own glyph and colours, when they picked one. Display only — editing lives in
     * the playground. */
    chrome?: {glyph: ReactNode; className: string; style?: CSSProperties}
}

const WorkflowIdentityView = ({
    displayType,
    name,
    selected,
    showDetails = true,
    chrome,
}: WorkflowIdentityViewProps) => {
    const {Icon, className, label} = WORKFLOW_DISPLAY_META[displayType]
    const glyphSize = showDetails ? 17 : 14

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
                    chrome?.className ?? className,
                )}
                style={chrome?.style}
            >
                {chrome?.glyph ?? <Icon size={glyphSize} />}
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
                <span className="text-[12px] leading-3 text-colorTextTertiary">{label}</span>
            </div>
            {selected && <Check size={16} className="shrink-0" />}
        </div>
    )
}

const AppWorkflowIdentity = ({
    workflowId,
    ...props
}: Omit<WorkflowIdentityViewProps, "displayType" | "chrome"> & {workflowId: string}) => {
    const appType = useAtomValue(workflowAppTypeAtomFamily(workflowId))
    const isAgent = appType === "agent"
    // Only agents can carry an icon, and a null id collapses every other row onto one shared atom
    // instead of giving each its own subscription.
    const chrome = useAgentIconChrome(isAgent ? workflowId : null, {
        size: props.showDetails === false ? 14 : 17,
        fallbackGlyph: null,
    })

    return (
        <WorkflowIdentityView
            {...props}
            displayType={isAgent ? "agent" : "prompt"}
            chrome={chrome.style ? chrome : undefined}
        />
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
