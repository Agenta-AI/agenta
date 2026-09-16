import {useTypewriter} from "@agenta/chat/hooks"
import ChatMarkdown from "@agenta/chat/markdown"
import {chatFileResolver} from "@agenta/entity-ui/drive"
import {Check, Copy} from "lucide-react"
import type {IconMap} from "streamdown"

/**
 * Streamdown's built-in classes assume a 14–30px type scale; the mobile app's base is 12px.
 * Descendant selectors (specificity 0,2,0+) win over its own single-class utilities without
 * having to fork every element renderer. Semantic tokens only — the `sidebar` role Streamdown
 * reaches for is not part of the generated token bridge, so code/table chrome is re-surfaced
 * onto `muted`, and long unbroken tokens wrap instead of widening the viewport.
 *
 * From `sm:` the prose steps up to the desktop app's 14px body (oss AgentChatSlice/markdown.tsx),
 * so a wide window reads at the same scale as /w instead of staying phone-sized.
 */
export const proseClassName = [
    // 20/22px leading, two over the size's own: prose that reads at length wants the air.
    "w-full min-w-0 space-y-2 overflow-hidden text-xs leading-5 wrap-anywhere sm:text-sm sm:leading-[22px]",
    "[&_a]:text-primary [&_a]:font-medium [&_a]:underline",
    "[&_p]:text-foreground [&_p]:text-xs [&_p]:leading-5 sm:[&_p]:text-sm sm:[&_p]:leading-[22px]",
    "[&_:is(h1,h2,h3,h4,h5,h6)]:mt-3 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-1",
    "[&_h1]:text-base [&_:is(h2,h3)]:text-sm [&_:is(h4,h5,h6)]:text-xs sm:[&_:is(h4,h5,h6)]:text-sm",
    "[&_:is(ul,ol)]:my-1 [&_li]:py-0.5 [&_li]:text-xs [&_li]:leading-5 sm:[&_li]:text-sm sm:[&_li]:leading-[22px]",
    "[&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:leading-5 sm:[&_blockquote]:text-sm sm:[&_blockquote]:leading-[22px] [&_blockquote_p]:text-muted-foreground",
    "[&_hr]:my-3",
    "[&_code]:text-[0.95em]",
    "[&_:is(th,td)]:px-2 [&_:is(th,td)]:py-1 [&_:is(th,td)]:text-xs",
    // A fence as one surface: Streamdown ships three borders for one block.
    "[&_[data-streamdown=code-block]]:my-2 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:overflow-hidden [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:border-border [&_[data-streamdown=code-block]]:bg-muted [&_[data-streamdown=code-block]]:p-0",
    "[&_[data-streamdown=code-block-header]]:h-7 [&_[data-streamdown=code-block-header]]:border-b [&_[data-streamdown=code-block-header]]:border-border [&_[data-streamdown=code-block-header]]:px-3 [&_[data-streamdown=code-block-header]]:text-[11px] [&_[data-streamdown=code-block-header]]:tracking-[0.02em] [&_[data-streamdown=code-block-header]_span]:ml-0",
    // The actions' sticky frame is unlabelled: reach it as the header's sibling.
    "[&_[data-streamdown=code-block-header]+div]:-mt-7 [&_[data-streamdown=code-block-header]+div]:h-7 [&_[data-streamdown=code-block-header]+div]:top-0 [&_[data-streamdown=code-block-header]+div]:pr-1.5",
    "[&_[data-streamdown=code-block-actions]]:rounded-none [&_[data-streamdown=code-block-actions]]:border-0 [&_[data-streamdown=code-block-actions]]:bg-transparent [&_[data-streamdown=code-block-actions]]:p-0 [&_[data-streamdown=code-block-actions]]:backdrop-blur-none",
    "[&_[data-streamdown=code-block-copy-button]]:flex [&_[data-streamdown=code-block-copy-button]]:size-[22px] [&_[data-streamdown=code-block-copy-button]]:items-center [&_[data-streamdown=code-block-copy-button]]:justify-center [&_[data-streamdown=code-block-copy-button]]:rounded [&_[data-streamdown=code-block-copy-button]]:p-0 [&_[data-streamdown=code-block-copy-button]]:hover:bg-accent",
    "[&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:px-3 [&_[data-streamdown=code-block-body]]:py-2.5 [&_[data-streamdown=code-block-body]]:text-xs [&_[data-streamdown=code-block-body]]:leading-[18px]",
    "[&_[data-streamdown=table-wrapper]]:bg-muted",
].join(" ")

/** The app's own glyph set on the fence's copy control — Streamdown's default is a different
 * icon family. Module scope: one identity across streamed tokens. */
export const markdownIcons: Partial<IconMap> = {CopyIcon: Copy, CheckIcon: Check}

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
            baseClassName={proseClassName}
            content={revealed}
            streaming={streaming || !settled}
            useLinkResolver={useDriveLinkResolver}
            icons={markdownIcons}
        />
    )
}
