import {pageContentWidthClass} from "@agenta/ui/components/page-width"

import {NewAgentAction} from "../agents/NewAgentAction"
import {useNewAgentAction} from "../agents/useNewAgentAction"

import {FIRST_RUN_COPY} from "./copy"
import {FirstRunComposer} from "./FirstRunComposer"

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
 * The template action is the shared create button, so a template pick here runs exactly the same
 * seed-and-hand-off as the one on Home.
 */
export const FirstRunScreen = ({base}: {base: string}) => {
    const newAgent = useNewAgentAction(base)

    return (
        <div className={`${pageContentWidthClass} flex flex-col gap-5 px-4 pb-6 lg:px-16 lg:pt-14`}>
            <div className="flex flex-col gap-2">
                <h1 className="m-0 text-2xl font-semibold leading-tight">{FIRST_RUN_COPY.title}</h1>
                <p className="text-muted-foreground m-0 text-sm">{FIRST_RUN_COPY.subtitle}</p>
            </div>

            <FirstRunComposer newAgent={newAgent} />

            {/* One error line for the whole screen, under the composer that is the primary way to
                act here. Both entries drive the same hook, so `NewAgentAction` is told not to
                print it a second time beside its own button. */}
            {newAgent.error ? (
                <p className="text-destructive m-0 text-xs">{newAgent.error}</p>
            ) : null}

            <div className="flex flex-col items-start gap-2">
                <span className="text-muted-foreground text-xs">{FIRST_RUN_COPY.templates}</span>
                <NewAgentAction
                    create={() => void newAgent.create()}
                    createFromTemplate={newAgent.createFromTemplate}
                    base={base}
                    label="Browse templates"
                    creating={newAgent.creating}
                    error={null}
                />
            </div>
        </div>
    )
}
