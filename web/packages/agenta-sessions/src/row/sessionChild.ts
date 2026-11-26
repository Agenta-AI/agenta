import type {SessionStream} from "@agenta/entities/session"

/** Did an agent in another session create this session (origin `calling_session`)? */
export const isChildSession = (row: Pick<SessionStream, "origin">): boolean =>
    row.origin === "calling_session"
