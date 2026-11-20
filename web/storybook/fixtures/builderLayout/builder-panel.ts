import type {BuilderChatRow} from "../../../mobile/src/features/builder/openRule"

/**
 * The builder chats about "Support triage" of canvas frames S07, S08 and S09, with their ages.
 * Ages are relative to the moment the story renders.
 */
export const BUILDER_PANEL_AGENT = "Support triage"

/** The page session of S07 and S08, under the context chip. */
export const PAGE_SESSION = {id: "s_charged", name: "Charged twice for March"}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

const chat = (id: string, name: string, days: number): BuilderChatRow => ({
    session_id: id,
    name,
    updated_at: daysAgo(days),
})

export const BUILDER_CHATS: BuilderChatRow[] = [
    chat("bc_1", "Shorter replies for billing tickets", 3),
    chat("bc_2", "Add the refund skill", 8),
    chat("bc_3", "Why the Safari ticket was not labeled", 15),
    chat("bc_4", "Label tickets by product area", 22),
    chat("bc_5", "Test with last week's tickets", 29),
    chat("bc_6", "Connect Slack for urgent tickets", 41),
    chat("bc_7", "Daily summary at 09:00", 48),
    chat("bc_8", "Stop asking for the order number twice", 63),
    chat("bc_9", "Create the Support triage agent", 70),
]
