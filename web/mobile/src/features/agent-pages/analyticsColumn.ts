import {SESSIONS_PAGE_FRAME} from "../sessions/pageFrame"

import {AGENT_PAGE_COLUMN} from "./configurationTabs"

/** The Analytics page column on a phone, else on a desktop (A09); its loading state uses it too. */
export const agentAnalyticsColumnClass = (phone: boolean) =>
    phone ? `min-w-0 px-4 pb-12 pt-3 ${SESSIONS_PAGE_FRAME}` : `${AGENT_PAGE_COLUMN} pb-10 pt-4`
