import {useCallback} from "react"

import {revealConfigPaneAtom} from "@agenta/chat/state"
import {AgentOverviewBody} from "@agenta/entity-ui/agent"
import {RichChatInput} from "@agenta/ui/rich-chat-input"

import {useStartAgentSession} from "@/oss/components/AgentChatSlice/hooks/useStartAgentSession"
import {sessionRouteModes} from "@/oss/components/pages/sessions/assets/sessionRouteScope"
import {useSessionCardVerbs} from "@/oss/components/pages/sessions/components/useSessionCardVerbs"
import {
    SeedAttachButton,
    SeedAttachmentChips,
    useSeedAttachments,
} from "@/oss/components/SeedAttachments"
import UsageSummary from "@/oss/components/UsageSummary"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"

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
 * The page scrolls as one. The columns used to scroll independently inside a bounded frame,
 * which put two scrollbars on one page and left the rail and the reading column disagreeing
 * about where the top was.
 */
const AgentOverview = ({appId, agentName}: Props) => {
    const startSession = useStartAgentSession()

    // "View all" stays on this agent's rail rather than dropping you on the project list with a
    // filter you then have to trust.
    const {appURL} = useURL()
    const sessionsHref = appURL ? `${appURL}/sessions` : undefined
    const automationSessionsHref = sessionsHref
        ? `${sessionsHref}?mode=${sessionRouteModes.automation}`
        : undefined

    const verbs = useSessionCardVerbs()
    const {goToPlayground} = usePlaygroundNavigation()
    const revealConfigPane = useSetAtom(revealConfigPaneAtom)
    // Edit asks for the configuration, so it clears what hides it before navigating (#6381).
    const openConfig = useCallback(() => {
        revealConfigPane()
        goToPlayground(undefined, {appId})
    }, [goToPlayground, appId, revealConfigPane])

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
            sessionsHref={sessionsHref ?? ""}
            automationSessionsHref={automationSessionsHref}
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
