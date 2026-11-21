import {SESSIONS_PAGE_FRAME} from "../sessions/pageFrame"

/** The Analytics page column on a phone, else on a desktop (A09); its loading state uses it too. */
export const agentAnalyticsColumnClass = (phone: boolean) =>
    phone
        ? `min-w-0 px-4 pb-12 pt-3 ${SESSIONS_PAGE_FRAME}`
        : "mx-auto box-border w-full max-w-[928px] px-8 pb-10 pt-4"
