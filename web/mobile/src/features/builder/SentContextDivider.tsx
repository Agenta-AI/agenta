import type {ReactNode} from "react"

import type {UIMessage} from "ai"

import {chipText, usePageLabel} from "./chipText"
import {ContextDivider} from "./ContextDivider"
import {pagePartKey, sentContextOf, type PageContext} from "./pageContext"

type PagedContext = PageContext & {page: NonNullable<PageContext["page"]>}

/** The context of a message sent with a page part; a message sent with the chip removed has none. */
const pagedContextOf = (message: UIMessage): PagedContext | null => {
    if (message.role !== "user") return null
    const context = sentContextOf(message)
    return context?.page ? (context as PagedContext) : null
}

/** What the builder was looking at, by ids, so names that load late or repeat never count. */
const contextKey = (context: PagedContext) =>
    `${context.agent.id}\u0000${pagePartKey(context.page)}`

/** The divider text: the agent and the page part's label. */
export const SentContextDivider = ({context}: {context: PagedContext}) => {
    const pageLabel = usePageLabel()
    return <ContextDivider text={chipText(context.agent.name, pageLabel(context.page))} />
}

/**
 * The `userMessageAccessory` of a builder chat: a divider when the message's context differs from
 * the last earlier shown message sent with one. The first shown one always gets its divider.
 */
export const sentContextDivider = (message: UIMessage, earlier: UIMessage[]): ReactNode => {
    const context = pagedContextOf(message)
    if (!context) return null
    for (let at = earlier.length - 1; at >= 0; at--) {
        const before = pagedContextOf(earlier[at])
        if (!before) continue
        return contextKey(before) === contextKey(context) ? null : (
            <SentContextDivider context={context} />
        )
    }
    return <SentContextDivider context={context} />
}
