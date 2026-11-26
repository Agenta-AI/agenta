import type {ReactNode} from "react"

import type {UIMessage} from "ai"

import {chipText, usePageLabel} from "./chipText"
import {ContextDivider} from "./ContextDivider"
import {sentContextOf, type PageContext} from "./pageContext"

/** What the builder was looking at: the agent and its page part. */
const contextKey = (context: PageContext | null, label: (c: PageContext) => string | null) =>
    context ? `${context.agent.id}\u0000${label(context) ?? ""}` : ""

/** The divider above a sent message, when its context differs from the previous sent message's. */
export const SentContextDivider = ({
    message,
    previous,
}: {
    message: UIMessage
    previous: UIMessage | null
}) => {
    const pageLabel = usePageLabel()
    const context = sentContextOf(message)
    // A message sent with the chip removed carries the agent only: no page part, no divider.
    if (!context?.page) return null
    const label = (c: PageContext) => pageLabel(c.page)
    const before = previous ? sentContextOf(previous) : null
    if (contextKey(context, label) === contextKey(before, label)) return null
    return <ContextDivider text={chipText(context.agent.name, label(context))} />
}

/** The `userMessageAccessory` of a builder chat. */
export const sentContextDivider = (message: UIMessage, previous: UIMessage | null): ReactNode => (
    <SentContextDivider message={message} previous={previous} />
)
