import type {CatalogKey} from "@agenta/i18n"
import type builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

type PanelKey = CatalogKey<typeof builderPanelCatalog>

/** The quick actions of a new builder chat, each with its ready requests (BEHAVIOR 1.3b). */
export const QUICK_ACTIONS = ["improve", "test", "skills", "automate", "explain"] as const
export type QuickAction = (typeof QUICK_ACTIONS)[number]

export const QUICK_ACTION_LABELS: Record<QuickAction, PanelKey> = {
    improve: "builder.panel.quickImprove",
    test: "builder.panel.quickTest",
    skills: "builder.panel.quickSkills",
    automate: "builder.panel.quickAutomate",
    explain: "builder.panel.quickExplain",
}

/** A ready request: the text it puts in the composer and the line under it. */
export interface ReadyRequest {
    request: PanelKey
    line: PanelKey
}

/** Three ready requests per quick action. */
export const READY_REQUESTS: Record<QuickAction, readonly ReadyRequest[]> = {
    improve: [
        {request: "builder.panel.readyImproveFind", line: "builder.panel.readyImproveFindLine"},
        {
            request: "builder.panel.readyImproveShorter",
            line: "builder.panel.readyImproveShorterLine",
        },
        {request: "builder.panel.readyImproveFollow", line: "builder.panel.readyImproveFollowLine"},
    ],
    test: [
        {request: "builder.panel.readyTestSamples", line: "builder.panel.readyTestSamplesLine"},
        {request: "builder.panel.readyTestRunAgain", line: "builder.panel.readyTestRunAgainLine"},
        {request: "builder.panel.readyTestFindWrong", line: "builder.panel.readyTestFindWrongLine"},
    ],
    skills: [
        {request: "builder.panel.readySkillsSuggest", line: "builder.panel.readySkillsSuggestLine"},
        {request: "builder.panel.readySkillsCreate", line: "builder.panel.readySkillsCreateLine"},
        {request: "builder.panel.readySkillsCheck", line: "builder.panel.readySkillsCheckLine"},
    ],
    automate: [
        {request: "builder.panel.readyAutomateDaily", line: "builder.panel.readyAutomateDailyLine"},
        {request: "builder.panel.readyAutomateApp", line: "builder.panel.readyAutomateAppLine"},
        {request: "builder.panel.readyAutomateSlack", line: "builder.panel.readyAutomateSlackLine"},
    ],
    explain: [
        {request: "builder.panel.readyExplainAgent", line: "builder.panel.readyExplainAgentLine"},
        {
            request: "builder.panel.readyExplainSession",
            line: "builder.panel.readyExplainSessionLine",
        },
        {request: "builder.panel.readyExplainAnswer", line: "builder.panel.readyExplainAnswerLine"},
    ],
}

/**
 * The open quick action per builder session. It outlives a remount of the panel (a move between a
 * session and an agent page), as the composer draft does (design D6).
 */
const openQuickActionBySession = new Map<string, QuickAction>()

export const readOpenQuickAction = (sessionId: string): QuickAction | null =>
    openQuickActionBySession.get(sessionId) ?? null

export const writeOpenQuickAction = (sessionId: string, action: QuickAction | null) => {
    if (action) openQuickActionBySession.set(sessionId, action)
    else openQuickActionBySession.delete(sessionId)
}
