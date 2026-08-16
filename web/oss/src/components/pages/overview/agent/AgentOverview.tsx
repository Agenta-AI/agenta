import {useCallback, useEffect} from "react"

import {AgentOverviewBody} from "@agenta/entity-ui/agent"
import {RichChatInput} from "@agenta/ui/rich-chat-input"
import {useSetAtom} from "jotai"

import {useStartAgentSession} from "@/oss/components/AgentChatSlice/hooks/useStartAgentSession"
import {useSessionCardVerbs} from "@/oss/components/pages/sessions/components/useSessionCardVerbs"
import {
    SeedAttachButton,
    SeedAttachmentChips,
    useSeedAttachments,
} from "@/oss/components/SeedAttachments"
import UsageSummary from "@/oss/components/UsageSummary"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"
import {layoutFullHeightRequestAtom} from "@/oss/state/layout/fullHeight"

interface Props {
    appId: string
    /** Used only in the composer's placeholder, so a null name degrades to a generic prompt. */
    agentName?: string
}

/**
 * An agent's overview: activity in the main column, identity in the rail.
 *
 * The page it replaces led with four full-page charts, so a freshly created agent's overview was
 * four empty rectangles and no way to see what the agent even was. Metrics move into the rail's
 * usage strip, which expands to the same dashboard for anyone who came for them.
 *
 * Configuration sits in the rail rather than under the composer because it is reference material:
 * it answers a first visit, while "what happened / what needs me" answers every visit after. With
 * it in the main column a waiting session sat below six rows of settings. The rail is also the
 * width the config rows were designed for — they come from the playground's panel, which is narrow.
 *
 * Columns scroll independently, as Home's do. They did not when this page held one list; with
 * Sessions and Automation runs both in the main column it outgrew the rail, and a whole-page
 * scroll meant losing the configuration while reading the sessions. The full-height frame is
 * requested rather than matched on the path, because this route also serves the prompt and
 * evaluator overviews, which still flow.
 */
const AgentOverview = ({appId, agentName}: Props) => {
    const startSession = useStartAgentSession()
    // The layout can't tell an agent overview from a prompt one by its path, so this branch asks
    // for the bounded frame and releases it on the way out.
    const requestFullHeight = useSetAtom(layoutFullHeightRequestAtom)
    useEffect(() => {
        requestFullHeight(true)
        return () => requestFullHeight(false)
    }, [requestFullHeight])

    // "View all" stays on this agent's rail rather than dropping you on the project list with a
    // filter you then have to trust. That route needs the app id to have reached URL state, which
    // lags the project's; until it does the project list — which DOES take the agent as a filter,
    // hence the flag below — stands in, so the affordance never links to `""` (the current route,
    // i.e. a click that does nothing). While even the project is unresolved there is no honest
    // target and the cards render without one, rather than holding the whole page for it.
    const {appURL, projectURL} = useURL()
    const sessionsHref = appURL
        ? `${appURL}/sessions`
        : projectURL
          ? `${projectURL}/sessions`
          : undefined

    const verbs = useSessionCardVerbs()
    const {goToPlayground} = usePlaygroundNavigation()
    const openConfig = useCallback(
        () => goToPlayground(undefined, {appId}),
        [goToPlayground, appId],
    )

    const attachments = useSeedAttachments()

    const handleSubmit = useCallback(
        (markdown: string) => {
            if (!markdown.trim() && !attachments.files.length) return
            startSession({appId, message: markdown, files: attachments.files})
            attachments.clear()
        },
        [appId, startSession, attachments],
    )

    return (
        <AgentOverviewBody
            agentId={appId}
            sessionsHref={sessionsHref}
            sessionsHrefScopesAgent={Boolean(appURL)}
            onEditConfig={openConfig}
            usage={<UsageSummary variant="strip" />}
            {...verbs}
            composer={
                <RichChatInput
                    // The column scrolls, so every child of it is shrinkable by default and this
                    // one collapsed to a hairline under the title once the lists overflowed.
                    className="shrink-0"
                    onSubmit={handleSubmit}
                    sendForceEnabled={attachments.files.length > 0}
                    header={
                        <SeedAttachmentChips
                            files={attachments.files}
                            onChange={attachments.setFiles}
                        />
                    }
                    // Leading, like the playground's — the footer's right edge belongs to send.
                    prefix={
                        attachments.enabled ? (
                            <SeedAttachButton
                                files={attachments.files}
                                onChange={attachments.setFiles}
                            />
                        ) : null
                    }
                    size="comfortable"
                    minHeightClassName="min-h-20"
                    textSizeClassName="text-sm"
                    placeholder={
                        agentName
                            ? `Ask ${agentName}\u2026 \u2014 starts a new session`
                            : "Describe a task \u2014 starts a new session"
                    }
                />
            }
        />
    )
}

export default AgentOverview
