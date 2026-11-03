import {rowsFromPages, useSessionList, useWaitingByAgent} from "@agenta/sessions/state"

/**
 * The agent's most recent session, whenever it ran.
 *
 * One row's worth of the server's own activity ordering — exact rather than derived from whatever
 * happened to be in the list's window. This is one single-row request per roster row; the roster
 * is a short, stable table, so it stays cheap where the session list (long, polling) would not.
 */
export function useAgentLastSession(agentId: string) {
    const query = useSessionList({
        agentId,
        originPolicy: "all",
        expansions: ["trigger"],
        limit: 1,
        enabled: Boolean(agentId),
    })
    const rows = rowsFromPages(query.data?.pages)

    return {
        session: rows[0] ?? null,
        isPending: query.isPending,
    }
}

/** The roster's waiting counts now live in `@agenta/sessions/state` — both apps' rosters need
 * them. Re-exported so this module stays the table's single import site. */
export {useWaitingByAgent}
