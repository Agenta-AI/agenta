import type {ReactNode} from "react"

import {useIntegrationIdentity} from "@agenta/entity-ui/clientTools"
import type {ToolUIPart} from "ai"

import {partToolName} from "../../model"
import {canonicalToolName, resolveToolDisplay} from "../../skin"

import {ActivityAnswersStep} from "./ActivityAnswersStep"
import {ActivityNode} from "./activityIcons"

/**
 * A browser-fulfilled tool on the timeline: the node says what kind of ask it is (a question, a
 * connect), the host's widget beside it does the asking. It is the reader's move, so the node
 * wears the warning tint until the part settles — unless the ask names an app, whose logo is the
 * node, as on any gateway step. Each connect request is its own step, so several apps stack.
 */
/** The node, with the app's own mark when the ask names one. Only that case mounts the lookup. */
const AppNode = ({
    sourceKey,
    ...props
}: {sourceKey?: string} & Parameters<typeof ActivityNode>[0]) =>
    sourceKey ? <CatalogNode sourceKey={sourceKey} {...props} /> : <ActivityNode {...props} />

const CatalogNode = ({
    sourceKey,
    ...props
}: {sourceKey: string} & Parameters<typeof ActivityNode>[0]) => {
    const {label, logo} = useIntegrationIdentity(sourceKey)
    return <ActivityNode {...props} logo={logo} appLabel={label} />
}

export const ActivityClientStep = ({
    part,
    render,
}: {
    part: ToolUIPart
    render?: (part: ToolUIPart) => ReactNode
}) => {
    const name = partToolName(part)
    const display = resolveToolDisplay(name, (part as {input?: unknown}).input)
    const settled = (part.state as string).startsWith("output-")
    // A question is a step of its own in every state: its widget is desktop chrome, and the form
    // lives in the dock.
    if (canonicalToolName(name) === "request_input") return <ActivityAnswersStep part={part} />
    const widget = render?.(part)
    return (
        <div className="flex min-w-0 items-center gap-3.5">
            <AppNode sourceKey={display.sourceKey} icon={display.icon} yourTurn={!settled} />
            <div className="min-w-0 flex-1">
                {widget ?? (
                    <span className="text-sm text-colorText">
                        {settled ? display.activity.done : display.activity.running}
                    </span>
                )}
            </div>
        </div>
    )
}
