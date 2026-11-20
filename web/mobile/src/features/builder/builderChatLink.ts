/**
 * The link from a builder chat to the agent it is about, kept in this browser (design D12, shared
 * contract SC8). Per user and project: for each agent id, its builder chat ids, newest first. No
 * server field holds the link, so another browser does not know it (documented limit).
 *
 * Every read and write survives a browser that refuses storage: the panel then opens a new chat.
 */

/** At most this many chats are kept per agent; the oldest go first. */
const MAX_CHATS_PER_AGENT = 50

export const builderChatsKey = (userId: string, projectId: string) =>
    `agenta:builder:chats:${userId}:${projectId}`

type ChatLinks = Record<string, string[]>

const readLinks = (key: string): ChatLinks => {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}")
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
        const links: ChatLinks = {}
        for (const [agentId, ids] of Object.entries(parsed)) {
            if (!Array.isArray(ids)) continue
            links[agentId] = ids.filter((id): id is string => typeof id === "string" && !!id)
        }
        return links
    } catch {
        return {}
    }
}

/** The builder chat ids about `agentId`, newest first. Empty when storage cannot be read. */
export const readBuilderChats = (userId: string, projectId: string, agentId: string): string[] =>
    readLinks(builderChatsKey(userId, projectId))[agentId] ?? []

/**
 * Puts `chatId` first in the list of `agentId`. A chat stays with its first agent: a chat already
 * listed under another agent is left there.
 */
export const rememberBuilderChat = (
    userId: string,
    projectId: string,
    agentId: string,
    chatId: string,
): void => {
    const key = builderChatsKey(userId, projectId)
    const links = readLinks(key)
    const owner = Object.keys(links).find((id) => links[id]?.includes(chatId))
    if (owner && owner !== agentId) return
    const chats = [chatId, ...(links[agentId] ?? []).filter((id) => id !== chatId)]
    links[agentId] = chats.slice(0, MAX_CHATS_PER_AGENT)
    try {
        window.localStorage.setItem(key, JSON.stringify(links))
    } catch {
        // Storage refused: the chat works, the panel just cannot find it again.
    }
}
