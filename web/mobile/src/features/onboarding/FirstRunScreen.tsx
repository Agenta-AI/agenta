import {templateBuilderMessage, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {useAgentSetupStep} from "@agenta/entity-ui/onboarding"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useRouter} from "next/router"

import {CONNECT_STEP_MODE} from "@/lib/connectStep"

import {useNewAgentAction} from "../agents/useNewAgentAction"

import {FIRST_RUN_COPY} from "./copy"
import {FirstRunComposer} from "./FirstRunComposer"
import {FirstRunTemplates} from "./FirstRunTemplates"

/**
 * What a brand-new project shows instead of Home: the desktop's onboarding question, and a
 * composer you can type in immediately.
 *
 * Home is the wrong first screen for someone with nothing. It asks "What do you want to do?",
 * renders an empty agents panel, and — because its composer runs a task with an agent that
 * already exists — renders no composer at all, leaving one "New agent" button on an otherwise
 * empty page. Desktop never shows that: a first run redirects into the playground and asks what
 * you want to BUILD, with the composer already focused.
 *
 * Rendered in place, not behind a route of its own. The redirect is what forces desktop's
 * `useAgentsFirstRun` to be certain before it decides (`homeSurface` keeps the same rules); a
 * swap under the same URL corrects itself when the list lands, and leaves the nav drawer where it
 * was, which is how a keyless first-run user can still reach Settings.
 *
 * The connect step (#6043) lives here rather than in the composer because a TEMPLATE pick opens
 * it too, and because the templates row has to stand down while it is open.
 */
export const FirstRunScreen = ({base}: {base: string}) => {
    const newAgent = useNewAgentAction(base)
    const router = useRouter()
    const step = useAgentSetupStep()

    const pickTemplate = (template: AgentStarterTemplate) => {
        // A template declares the accounts it needs, so it always has something to connect.
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

    return (
        // `pageContentWidthClass` carries the page gutters; the inner column is the narrower
        // measure this surface actually wants — one question and one answer, not a data table.
        // Without it the composer stretches the full window on a desktop viewport.
        <div className={`${pageContentWidthClass} px-4 pb-6 lg:px-16 lg:pt-14`}>
            <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <h1 className="m-0 text-2xl font-semibold leading-tight lg:text-[32px]">
                        {FIRST_RUN_COPY.title}
                    </h1>
                    <p className="text-muted-foreground m-0 text-sm lg:text-base">
                        {FIRST_RUN_COPY.subtitle}
                    </p>
                </div>

                <FirstRunComposer newAgent={newAgent} step={step} />

                {/* One error line for the whole screen, under the composer that is the primary way
                    to act here. Both entries drive the same hook, so it is printed once. */}
                {newAgent.error ? (
                    <p className="text-destructive m-0 text-xs">{newAgent.error}</p>
                ) : null}

                {/* The step replaces the offer: once you are connecting accounts for one agent, a
                    row of other agents to build is noise. */}
                {step.draft ? null : (
                    <FirstRunTemplates
                        onPick={pickTemplate}
                        onBrowseAll={() => void router.push(`${base}/templates`)}
                        disabled={newAgent.creating}
                    />
                )}
            </div>
        </div>
    )
}
