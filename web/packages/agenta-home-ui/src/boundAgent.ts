/**
 * The agent Home's composer binds when the page opens on the agents tab.
 *
 * An explicit pick wins; else the host's remembered agent (the one a chat was last started
 * with, #6741); else the head of the roster. An id no longer in the roster — the agent archived
 * since — is skipped rather than named, so nothing here binds something the page cannot show.
 */
export const resolveBoundAgentId = (
    agents: readonly {id: string}[],
    chosenId: string | null | undefined,
    preferredId: string | null | undefined,
): string | null => {
    const listed = (id: string | null | undefined) =>
        id && agents.some((agent) => agent.id === id) ? id : null
    return listed(chosenId) ?? listed(preferredId) ?? agents[0]?.id ?? null
}
