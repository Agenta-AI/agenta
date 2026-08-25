import {useState} from "react"

import {markSessionFresh} from "@agenta/chat/state"
import {templateBuilderMessage, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {useAgentSetupStep} from "@agenta/entity-ui/onboarding"
import {useRouter} from "next/router"

import {CONNECT_STEP_MODE} from "@/lib/connectStep"

import {useNewAgentAction} from "../agents/useNewAgentAction"
import {SessionWorkspace} from "../chat/SessionWorkspace"

import {FIRST_RUN_COPY} from "./copy"
import {FirstRunComposer} from "./FirstRunComposer"
import {FirstRunTemplates} from "./FirstRunTemplates"
import {useEphemeralAgent} from "./useEphemeralAgent"

/**
 * What a brand-new project shows instead of Home, and the mobile half of the desktop's
 * playground-native onboarding.
 *
 * Home is the wrong first screen for someone with nothing: it asks "What do you want to do?" and
 * its composer runs a task with an agent that already exists, so with none it disables itself and
 * leaves one button on an empty page.
 *
 * Like the desktop, this mounts the REAL workspace around a local-only agent minted up front, so
 * the config pane (model, instructions, tools) is live before anything is created — you can see
 * and change what you are about to build. The conversation half is replaced by the create surface
 * until the agent exists; submitting commits that same ephemeral rather than minting a second one.
 */
export const FirstRunScreen = ({
    base,
    workspaceId,
    projectId,
}: {
    base: string
    workspaceId: string
    projectId: string
}) => {
    const newAgent = useNewAgentAction(base)
    const router = useRouter()
    const step = useAgentSetupStep()
    const {entityId, error: mintError, retry} = useEphemeralAgent(true)

    // One session id for the whole pre-commit surface: the composer stages attachments against it
    // and the workspace keys its panes off it, so they must agree before the agent exists.
    const [sessionId] = useState(() => {
        const id = crypto.randomUUID()
        markSessionFresh(id)
        return id
    })

    const pickTemplate = (template: AgentStarterTemplate) => {
        if (CONNECT_STEP_MODE) {
            step.open({
                seedMessage: templateBuilderMessage(template),
                name: template.name,
                template,
            })
            return
        }
        newAgent.createFromTemplate(template.key)
    }

    const create = (
        // The desktop's shape: the question at the top, then the offer and the composer docked at
        // the bottom of the panel. `min-h-0` + the flex spacer is what pins them there instead of
        // letting the whole column sit under the hero.
        <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 pb-4 lg:px-8">
            <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-6 pt-8 lg:pt-14">
                <div className="flex flex-col gap-2">
                    <h1 className="m-0 text-2xl font-semibold leading-tight lg:text-[32px]">
                        {FIRST_RUN_COPY.title}
                    </h1>
                    <p className="text-muted-foreground m-0 text-sm lg:text-base">
                        {FIRST_RUN_COPY.subtitle}
                    </p>
                </div>

                {/* Pushes everything below to the bottom of the panel, as the desktop does. */}
                <div className="min-h-6 flex-1" />

                {step.draft ? null : (
                    <FirstRunTemplates
                        onPick={pickTemplate}
                        onBrowseAll={() => void router.push(`${base}/templates`)}
                        disabled={newAgent.creating}
                    />
                )}

                <FirstRunComposer
                    newAgent={newAgent}
                    step={step}
                    sessionId={sessionId}
                    entityId={entityId}
                />

                {/* One error line for the whole surface. A failed mint reports here too, with the
                    retry that releases its guard — never a surface that silently spins. */}
                {mintError ? (
                    <p className="text-destructive m-0 text-xs">
                        {mintError}{" "}
                        <button
                            type="button"
                            onClick={retry}
                            className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-xs underline"
                        >
                            Try again
                        </button>
                    </p>
                ) : null}
                {newAgent.error ? (
                    <p className="text-destructive m-0 text-xs">{newAgent.error}</p>
                ) : null}
            </div>
        </div>
    )

    return (
        <SessionWorkspace
            entityId={entityId}
            sessionId={sessionId}
            workspaceId={workspaceId}
            projectId={projectId}
            chat={create}
            // Home already renders the shell around this body; a second one stacks nav rails.
            bare
        />
    )
}
