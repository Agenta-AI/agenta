import {useTypewriter} from "@agenta/chat/hooks"
import ChatMarkdown from "@agenta/chat/markdown"
import {chatFileResolver, chatReplyFileResolver} from "@agenta/entity-ui/drive"
import {CheckIcon, CopyIcon} from "@phosphor-icons/react"
import type {IconMap} from "streamdown"

/**
 * Streamdown's built-in classes assume a 14–30px type scale; the app sets its own body scale
 * (text-body at every width).
 * Descendant selectors (specificity 0,2,0+) win over its own single-class utilities without
 * having to fork every element renderer. Semantic tokens only — the `sidebar` role Streamdown
 * reaches for is not part of the generated token bridge, so code chrome is re-surfaced onto
 * `muted`, and long unbroken tokens wrap instead of widening the viewport. Tables draw their own
 * frame (`ChatTable`), so nothing here styles them.
 */
const proseBase = [
    "w-full min-w-0 space-y-3 overflow-hidden wrap-anywhere sm:space-y-3.5",
    "[&_a]:text-link [&_a]:font-medium [&_a]:underline",
    "[&_p]:text-foreground",
    "[&_:is(h1,h2,h3,h4,h5,h6)]:mt-6 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-2 [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:tracking-tight",
    "[&_h1]:text-title [&_:is(h2,h3)]:text-body [&_:is(h2,h3)]:font-semibold [&_:is(h4,h5,h6)]:text-label",
    // Lists: our own 5px dot, hung in the indent; a nested list is a ruled block, not more dots.
    "[&_:is(ul,ol)]:my-1 [&_li]:py-0.5",
    "[&_ul]:list-none [&_ul]:pl-0 [&_ul>li]:relative [&_ul>li]:pl-4 [&_ul>li]:before:absolute [&_ul>li]:before:left-0.5 [&_ul>li]:before:top-[calc(0.125rem_+_0.5lh_-_2.5px)] [&_ul>li]:before:size-[5px] [&_ul>li]:before:rounded-[1px] [&_ul>li]:before:bg-foreground [&_ul>li:has(>input)]:pl-0 [&_ul>li:has(>input)]:before:hidden",
    "[&_li_ul]:my-1 [&_li_ul]:border-l [&_li_ul]:border-border/60 [&_li_ul]:pl-3.5 [&_li_ul>li]:pl-0 [&_li_ul>li]:before:hidden",
    "[&_ol]:list-outside [&_ol]:pl-5 [&_ol>li]:marker:text-muted-foreground",
    "[&_blockquote]:my-2 [&_blockquote]:border-l [&_blockquote]:border-border/60 [&_blockquote]:pl-3 [&_blockquote]:not-italic [&_blockquote]:text-muted-foreground [&_blockquote_p]:text-muted-foreground",
    // A quiet break: the heading after it carries the section.
    "[&_hr]:my-3 [&_hr]:border-transparent",
    "[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:border-0 [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em]",
    "[&_pre_code]:text-[0.95em]",
    // A fence as one surface: Streamdown ships three borders for one block.
    "[&_[data-streamdown=code-block]]:my-2 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:overflow-hidden [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:border-border/60 [&_[data-streamdown=code-block]]:bg-muted [&_[data-streamdown=code-block]]:p-0",
    "[&_[data-streamdown=code-block-header]]:h-7 [&_[data-streamdown=code-block-header]]:border-b [&_[data-streamdown=code-block-header]]:border-border/60 [&_[data-streamdown=code-block-header]]:px-3 [&_[data-streamdown=code-block-header]]:text-caption [&_[data-streamdown=code-block-header]]:tracking-[0.02em] [&_[data-streamdown=code-block-header]_span]:ml-0",
    // The actions' sticky frame is unlabelled: reach it as the header's sibling.
    "[&_[data-streamdown=code-block-header]+div]:-mt-7 [&_[data-streamdown=code-block-header]+div]:h-7 [&_[data-streamdown=code-block-header]+div]:top-0 [&_[data-streamdown=code-block-header]+div]:pr-1.5",
    "[&_[data-streamdown=code-block-actions]]:rounded-none [&_[data-streamdown=code-block-actions]]:border-0 [&_[data-streamdown=code-block-actions]]:bg-transparent [&_[data-streamdown=code-block-actions]]:p-0 [&_[data-streamdown=code-block-actions]]:backdrop-blur-none",
    "[&_[data-streamdown=code-block-copy-button]]:flex [&_[data-streamdown=code-block-copy-button]]:size-6 [&_[data-streamdown=code-block-copy-button]]:items-center [&_[data-streamdown=code-block-copy-button]]:justify-center [&_[data-streamdown=code-block-copy-button]]:rounded-sm [&_[data-streamdown=code-block-copy-button]]:p-0 [&_[data-streamdown=code-block-copy-button]]:hover:bg-accent",
    "[&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:px-3 [&_[data-streamdown=code-block-body]]:py-2.5 [&_[data-streamdown=code-block-body]]:text-code",
].join(" ")

// Prose is text-body on every element whose own Streamdown size would win; literals so Tailwind finds them.
const BODY_SCALE = ["text-body", "[&_p]:text-body", "[&_li]:text-body", "[&_blockquote]:text-body"].join(" ")
const APP_SCALE = BODY_SCALE
const CHAT_SCALE = BODY_SCALE

/** Markdown at the app scale (file previews, embeds, notes). */
export const proseClassName = `${proseBase} ${APP_SCALE}`
/** The chat's user and assistant messages, at the canvas scale. */
export const chatProseClassName = `${proseBase} ${CHAT_SCALE}`

/** The app's own glyph set on the fence's copy control — Streamdown's default is a different
 * icon family. Module scope: one identity across streamed tokens. */
export const markdownIcons: Partial<IconMap> = {CopyIcon, CheckIcon}

/**
 * Assistant message text rendered as markdown through the shared `ChatMarkdown` renderer, so
 * mobile and desktop parse, highlight, and heal identically; only the token layer differs.
 *
 * Text is revealed on the frame clock, so incomplete-markdown repair has to outlive the last
 * delta — until the reveal drains, what is on screen is a truncated prefix.
 */
/** A markdown link to a path, not to the web, opens the file in the Files pane (#6659). Module
 * scope so the renderer's resolver context keeps a stable identity across streamed tokens. */
export const useDriveLinkResolver = () => chatFileResolver

/** The same links, plus an inline preview under the paragraph for each image the reply names. */
const useReplyFileResolver = () => chatReplyFileResolver

export const AssistantMarkdown = ({
    streaming,
    text,
    urgent = false,
}: {
    streaming: boolean
    text: string
    /** The item is no longer last: finish fast so a tool line below never outruns its prose. */
    urgent?: boolean
}) => {
    const {text: revealed, settled} = useTypewriter(text, {urgent})
    return (
        <ChatMarkdown
            baseClassName={chatProseClassName}
            content={revealed}
            streaming={streaming || !settled}
            useLinkResolver={useReplyFileResolver}
            icons={markdownIcons}
        />
    )
}

/**
 * The user's own turn, through the same pipeline — no typewriter, nothing streams. The composer
 * serialises a draft as markdown, escapes and all, so a literal render showed `hi\_name` for a
 * typed `hi_name`; the desktop bubble has always rendered markdown, and this matches it.
 */
export const UserMarkdown = ({text}: {text: string}) => (
    <ChatMarkdown
        baseClassName={chatProseClassName}
        content={text}
        streaming={false}
        useLinkResolver={useDriveLinkResolver}
    />
)
