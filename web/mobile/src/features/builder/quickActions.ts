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

const ready = (name: string): ReadyRequest => ({
    request: `builder.panel.ready${name}` as PanelKey,
    line: `builder.panel.ready${name}Line` as PanelKey,
})

/** Three ready requests per quick action. */
export const READY_REQUESTS: Record<QuickAction, readonly ReadyRequest[]> = {
    improve: [ready("ImproveFind"), ready("ImproveShorter"), ready("ImproveFollow")],
    test: [ready("TestSamples"), ready("TestRunAgain"), ready("TestFindWrong")],
    skills: [ready("SkillsSuggest"), ready("SkillsCreate"), ready("SkillsCheck")],
    automate: [ready("AutomateDaily"), ready("AutomateApp"), ready("AutomateSlack")],
    explain: [ready("ExplainAgent"), ready("ExplainSession"), ready("ExplainAnswer")],
}

/**
 * The open quick action per builder chat. It outlives a remount of the panel (a move between a
 * session and an agent page), as the composer draft does (design D6).
 */
const openQuickActionByChat = new Map<string, QuickAction>()

export const readOpenQuickAction = (chatId: string): QuickAction | null =>
    openQuickActionByChat.get(chatId) ?? null

export const writeOpenQuickAction = (chatId: string, action: QuickAction | null) => {
    if (action) openQuickActionByChat.set(chatId, action)
    else openQuickActionByChat.delete(chatId)
}
