import {memo, type ReactNode} from "react"

import {useTypewriter} from "@agenta/chat/hooks"
import {useDriveSessionId} from "@agenta/entity-ui/drive"
import {code} from "@streamdown/code"
import {math} from "@streamdown/math"
import {useAtomValue} from "jotai"
import {Streamdown, type Components, type ThemeInput} from "streamdown"

import {chatFileLinkAtomFamily} from "../state/fileLinks"

// Dark-mode-aware markdown styling. `min-w-0` + `max-w-full` + the per-element width guards
// keep long lines / code blocks from widening their container; code blocks scroll within their
// own box instead. Streamdown ships shadcn-token typography we don't have on desktop, so every
// block is restyled here explicitly onto antd tokens (same override-layer pattern as mobile's
// AssistantMarkdown, at desktop's text-sm scale).
export const MD_CLASS =
    // Rhythm and scale are the desktop app's, measured off v0.112.1: base 14px, and the gaps
    // between blocks 12 / 4 / 14 / 14 / 8 / 12 / 20. Streamdown wraps every block in its own
    // div, so sibling margins can't collapse the way antd-x's did — the root gap is therefore
    // zero and each block owns only the space BELOW it (every `mt` stays 0). Bottom-margin-only
    // reproduces those gaps exactly and can never double up.
    "min-w-0 max-w-full space-y-0 overflow-hidden break-words text-sm leading-relaxed " +
    "[&_a]:text-colorPrimary [&_a]:underline [&_a]:break-all " +
    "[&_p]:!mt-0 [&_p]:!mb-3.5 [&_p]:!break-words " +
    "[&_ul]:!mt-0 [&_ul]:!mb-3.5 [&_ul]:!list-outside [&_ul]:!pl-3.5 " +
    "[&_ol]:!mt-0 [&_ol]:!mb-3.5 [&_ol]:!list-outside [&_ol]:!pl-3.5 " +
    "[&_li]:!my-0.5 [&_li]:!py-0 [&_li_p]:!my-0 [&_li_ul]:!my-0 [&_li_ol]:!my-0 " +
    "[&_blockquote_p]:!my-0 [&_code]:rounded " +
    "[&_code]:bg-colorFillTertiary [&_code]:px-1 [&_code]:break-words " +
    // Tables: real borders + padding, a quiet header, and `break-normal` cells so text wraps at
    // spaces instead of snapping mid-word ("PostH og"). Width is auto, as the desktop app sizes
    // it — `w-full` stretched a two-column table across the whole bubble.
    "[&_table]:mt-0 [&_table]:mb-3 [&_table]:w-auto [&_table]:border-collapse [&_table]:text-xs " +
    "[&_th]:border [&_th]:border-solid [&_th]:border-colorBorderSecondary [&_th]:bg-colorFillTertiary " +
    "[&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:align-top [&_th]:font-medium [&_th]:break-normal " +
    "[&_td]:border [&_td]:border-solid [&_td]:border-colorBorderSecondary " +
    "[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_td]:break-normal " +
    // Streamdown wraps tables for copy affordances; keep the wrapper quiet on antd surfaces.
    "[&_[data-streamdown=table-wrapper]]:!my-0 [&_[data-streamdown=table-wrapper]]:!overflow-x-auto " +
    // Headings — the desktop app's scale (h1 16/22, h2 14, the rest at body size on weight
    // alone), not the browser's, which is huge here.
    // Colour is `text-inherit`, NOT a fixed token: a global bare-`h1 { color:#333 }` rule
    // (editor-theme.css) leaks into every unstyled h1 and preflight is off so nothing normalises
    // it. `inherit` out-specifies that global rule (0,1,1 vs 0,0,1) and makes headings follow the
    // block's own colour — correct on any surface AND respecting a caller/ancestor recolour (e.g.
    // a muted context). Same guard on h2–h5 future-proofs against another stray global heading
    // rule; h6 stays intentionally quieter.
    "[&_h1]:!mt-0 [&_h1]:!mb-3 [&_h1]:!text-base [&_h1]:!font-semibold [&_h1]:!leading-[22px] [&_h1]:!text-inherit " +
    "[&_h2]:!mt-0 [&_h2]:!mb-1 [&_h2]:!text-sm [&_h2]:!font-semibold [&_h2]:!leading-snug [&_h2]:!text-inherit " +
    "[&_h3]:!mt-0 [&_h3]:!mb-1 [&_h3]:!text-sm [&_h3]:!font-semibold [&_h3]:!text-inherit " +
    "[&_h4]:!mt-0 [&_h4]:!mb-1 [&_h4]:!text-sm [&_h4]:!font-semibold [&_h4]:!text-inherit " +
    "[&_h5]:!mt-0 [&_h5]:!mb-1 [&_h5]:!text-sm [&_h5]:!font-semibold [&_h5]:!text-inherit " +
    "[&_h6]:!mt-0 [&_h6]:!mb-1 [&_h6]:!text-sm [&_h6]:!font-medium [&_h6]:!text-colorTextSecondary " +
    // Blockquote — a quiet left-ruled aside. Layout is forced (!important) so nothing (the UA's
    // logical `margin-inline: 40px`, the bubble's placement styles, etc.) can push the content into
    // a centered/over-indented look: no horizontal margin, a small left padding, left-aligned.
    // Zero the non-left borders with per-side longhands (NOT `border-0`, whose `border-width`
    // shorthand wins over `border-l-2` as an arbitrary variant and drops the left rule).
    "[&_blockquote]:!mt-0 [&_blockquote]:!mb-2 [&_blockquote]:!mx-0 [&_blockquote]:!pl-3 [&_blockquote]:!text-left " +
    "[&_blockquote]:border-y-0 [&_blockquote]:border-r-0 [&_blockquote]:border-l-2 " +
    "[&_blockquote]:border-solid [&_blockquote]:border-colorTextTertiary " +
    "[&_blockquote]:text-colorTextSecondary [&_blockquote]:italic " +
    // Rule, images, emphasis, strikethrough, and task-list checkboxes.
    "[&_hr]:!mt-4 [&_hr]:!mb-4 [&_hr]:!border-0 [&_hr]:!border-t [&_hr]:!border-solid [&_hr]:!border-colorBorderSecondary " +
    "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded " +
    "[&_strong]:font-semibold [&_em]:italic [&_del]:line-through " +
    // HTML passthrough (LLM output sometimes includes raw HTML): neutralise the elements whose UA
    // defaults are jarring with preflight off — <mark> (bright yellow bg) → a subtle theme
    // highlight, <kbd> → a keycap. <sub>/<sup> UA styling (position only) is already fine.
    "[&_mark]:rounded [&_mark]:bg-colorFillTertiary [&_mark]:px-0.5 [&_mark]:text-inherit " +
    "[&_kbd]:rounded [&_kbd]:border [&_kbd]:border-solid [&_kbd]:border-colorBorderSecondary " +
    "[&_kbd]:bg-colorFillTertiary [&_kbd]:px-1 [&_kbd]:font-mono [&_kbd]:text-[0.9em] " +
    "[&_li:has(input)]:list-none [&_input]:mr-1.5 [&_input]:align-middle " +
    // Fenced blocks are Streamdown's own CodeBlock (Shiki via the code plugin). Its stock chrome
    // assumes shadcn tokens (`bg-sidebar`, `border-border` — undefined here) AND preflight (our
    // app runs without it, so its <button>/<pre> leak UA borders and margins). Restyle the whole
    // block: one quiet box, a slim language header, an unboxed copy icon, and a reset for the
    // inline-chip `[&_code]` styles inside the block.
    "[&_[data-streamdown=code-block]]:!mt-0 [&_[data-streamdown=code-block]]:!mb-3 [&_[data-streamdown=code-block]]:!max-w-full " +
    "[&_[data-streamdown=code-block]]:!min-w-0 [&_[data-streamdown=code-block]]:!gap-0 " +
    "[&_[data-streamdown=code-block]]:!rounded-md [&_[data-streamdown=code-block]]:!p-0 " +
    "[&_[data-streamdown=code-block]]:!border [&_[data-streamdown=code-block]]:!border-solid " +
    "[&_[data-streamdown=code-block]]:!border-colorBorderSecondary [&_[data-streamdown=code-block]]:!bg-colorFillTertiary " +
    "[&_[data-streamdown=code-block-header]]:!h-7 [&_[data-streamdown=code-block-header]]:!px-3 " +
    "[&_[data-streamdown=code-block-header]]:!border-0 [&_[data-streamdown=code-block-header]]:!border-b " +
    "[&_[data-streamdown=code-block-header]]:!border-solid [&_[data-streamdown=code-block-header]]:!border-colorBorderSecondary " +
    "[&_[data-streamdown=code-block-header]]:!text-[12px] [&_[data-streamdown=code-block-header]]:!uppercase " +
    "[&_[data-streamdown=code-block-header]]:!tracking-wide [&_[data-streamdown=code-block-header]]:!text-colorTextTertiary " +
    "[&_[data-streamdown=code-block-actions]]:!border-0 [&_[data-streamdown=code-block-actions]]:!bg-transparent " +
    "[&_[data-streamdown=code-block-actions]]:!p-0 [&_[data-streamdown=code-block-actions]]:!backdrop-blur-none " +
    "[&_[data-streamdown=code-block-copy-button]]:!flex [&_[data-streamdown=code-block-copy-button]]:!cursor-pointer " +
    "[&_[data-streamdown=code-block-copy-button]]:!items-center [&_[data-streamdown=code-block-copy-button]]:!rounded " +
    "[&_[data-streamdown=code-block-copy-button]]:!border-0 [&_[data-streamdown=code-block-copy-button]]:!bg-transparent " +
    "[&_[data-streamdown=code-block-copy-button]]:!p-1 [&_[data-streamdown=code-block-copy-button]]:!text-colorTextSecondary " +
    "[&_[data-streamdown=code-block-copy-button]:hover]:!bg-colorFillSecondary [&_[data-streamdown=code-block-copy-button]:hover]:!text-colorText " +
    "[&_[data-streamdown=code-block]_.sticky]:!-mt-7 [&_[data-streamdown=code-block]_.sticky]:!h-7 " +
    "[&_[data-streamdown=code-block]_.sticky]:!top-1 [&_[data-streamdown=code-block]_.sticky]:!pr-1 " +
    "[&_[data-streamdown=code-block-body]]:!overflow-x-auto [&_[data-streamdown=code-block-body]]:!px-3 " +
    "[&_[data-streamdown=code-block-body]]:!py-2 [&_[data-streamdown=code-block-body]]:!text-xs " +
    "[&_[data-streamdown=code-block]_pre]:!m-0 [&_[data-streamdown=code-block]_pre]:!bg-transparent " +
    "[&_[data-streamdown=code-block]_pre]:!p-0 " +
    "[&_[data-streamdown=code-block]_code]:!bg-transparent [&_[data-streamdown=code-block]_code]:!p-0 " +
    // Streamdown renders one <span> per Shiki line but only classes it when `lineNumbers` is on,
    // and that class is what carries `block` — with numbers off every line ran together
    // ("a = 1b = 2c = 3" on one row). Make the line spans blocks ourselves.
    "[&_[data-streamdown=code-block]_pre_code>span]:!block " +
    // Trim the outer edges so the bubble padding isn't doubled by leading/trailing margins.
    "[&>:first-child]:!mt-0 [&>:last-child]:!mb-0 [&>:last-child>*]:!mb-0"

/** Flatten a code element's children (string / text nodes) to the raw source. */
const childrenToText = (children: ReactNode): string => {
    if (typeof children === "string") return children
    if (typeof children === "number") return String(children)
    if (Array.isArray(children)) return children.map(childrenToText).join("")
    if (children && typeof children === "object" && "props" in children) {
        return childrenToText((children as {props?: {children?: ReactNode}}).props?.children)
    }
    return ""
}

/**
 * Inline code chip. When the active conversation has published a file-link resolver and this span's
 * text names a real drive file, it renders as a compact inline file reference (icon + name, opens
 * Quick Look) that flows within the sentence — the heavy block file card is reserved for the tool
 * step that wrote the file. Otherwise it's a plain code chip.
 */
const InlineCode = ({className, children}: {className?: string; children?: ReactNode}) => {
    // Resolve against THIS conversation's session (from the ambient drive context), so a
    // backgrounded pane's file mentions don't read another mounted session's resolver.
    const sessionId = useDriveSessionId()
    const link = useAtomValue(chatFileLinkAtomFamily(sessionId ?? ""))
    const text = childrenToText(children).trim()
    const fallback = <code className={className}>{children}</code>
    // The Drives resolver decides link-vs-plain (async: records + on-demand single-file check) and
    // owns the fallback; no resolver mounted → plain code.
    if (link && text) return <>{link.renderCode(text, fallback)}</>
    return fallback
}

/** A link target that must stay a plain external link: any `scheme:` URL (http, https, mailto, tel,
 * data, …), a protocol-relative `//host`, or an in-page `#fragment`. Everything else is a RELATIVE
 * path, which might name a file in this conversation's drive. */
const isExternalHref = (href?: string): boolean =>
    !href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)

/** Only real anchor attributes — Streamdown also passes renderer internals (`node`, …) that would
 * leak onto the DOM element, so we never spread the incoming props. */
interface AnchorProps {
    href?: string
    title?: string
    className?: string
    children?: ReactNode
}

/** Plain link, opened in a new tab. Also the fallback whenever a relative href isn't a drive file. */
const ExternalLink = ({href, title, className, children}: AnchorProps) => (
    <a href={href} title={title} className={className} target="_blank" rel="noopener noreferrer">
        {children}
    </a>
)

/** A relative href may NAME a drive file — resolve it through the same resolver the inline-code path
 * uses ({@link InlineCode}), so a markdown link and a code-span mention of the same file behave
 * identically (issue #5481: nested / `NN-name/` paths get emitted as links and bypassed it). */
const DriveLink = ({href, ...rest}: AnchorProps) => {
    const sessionId = useDriveSessionId()
    const link = useAtomValue(chatFileLinkAtomFamily(sessionId ?? ""))
    // A slash-prefixed href is a local sandbox path, not a browser-relative web URL. If the drive
    // cannot prove it names a file, keep its label inert instead of navigating to
    // `https://<agenta-host>/tmp/...` (#5983).
    const fallback = href?.startsWith("/") ? (
        <>{rest.children}</>
    ) : (
        <ExternalLink href={href} {...rest} />
    )
    if (link && href) return <>{link.renderCode(href, fallback)}</>
    return fallback
}

/** Split so an ordinary URL costs nothing: only a relative href subscribes to the drive resolver. */
const Anchor = ({href, title, className, children}: AnchorProps) =>
    isExternalHref(href) ? (
        <ExternalLink href={href} title={title} className={className}>
            {children}
        </ExternalLink>
    ) : (
        <DriveLink href={href} title={title} className={className}>
            {children}
        </DriveLink>
    )

/** Stable maps/configs: fresh object literals per render churn Streamdown's prop identity, and
 * this renderer re-renders on every throttled streaming token — so hoist them to module scope.
 * `inlineCode` is Streamdown's dedicated inline-span slot; fenced blocks stay with its own
 * Shiki CodeBlock (the `code` plugin), which replaces the old Prism overlay wholesale. */
const MD_COMPONENTS: Components = {
    // Inline arrows so the map's contextual typing applies; only the real DOM props are
    // forwarded (Streamdown also passes renderer internals like `node`).
    inlineCode: ({className, children}) => (
        <InlineCode className={className}>{children}</InlineCode>
    ),
    a: ({href, title, className, children}) => (
        <Anchor href={href} title={title} className={className}>
            {children}
        </Anchor>
    ),
}

/** KaTeX math ($…$ / $$…$$) + Shiki-highlighted fences; both tree-shaken plugin packages. */
const MD_PLUGINS = {math, code}

/** Copy button on fences (the old renderer's overlay); no per-table/mermaid chrome. */
const MD_CONTROLS = {code: {copy: true, download: false}, mermaid: false, table: false} as const

/** Light/dark pair — Shiki dual themes track the app theme instead of the old always-dark Prism. */
const SHIKI_THEMES: [ThemeInput, ThemeInput] = ["one-light", "one-dark-pro"]

/** Shared markdown renderer for the slice — used by message bubbles and the composer live
 * preview, so both render identically. `className` appends to `MD_CLASS` so callers can tweak
 * size/color (e.g. the muted reasoning block) without forking the renderer.
 *
 * Sanitization: Streamdown's default rehype pipeline (`rehype-raw → rehype-sanitize (GitHub
 * schema) → rehype-harden`) replaces the old DOMPurify FORBID_TAGS config — document-affecting
 * tags, handlers, and javascript: URLs are stripped by default.
 *
 * Memoized on `content`/`className`: within the one message that re-renders per streamed token
 * (the streaming one), its already-settled parts — a reasoning block, text before a tool call —
 * keep the same `content` string, so this skips re-parsing + re-highlighting them each token. */
const Markdown = ({
    content,
    className,
    streaming = false,
}: {
    content: string
    className?: string
    /** Text is still growing OR still being revealed: keep incomplete-markdown healing on. The
     * typing feel comes from `StreamingMarkdown` below; streamdown's own animator stays off (it
     * is gated on an `isAnimating` prop we never pass, and its shared per-instance character
     * counter re-animates settled blocks on paragraph splits). */
    streaming?: boolean
}) => (
    <Streamdown
        className={className ? `${MD_CLASS} ${className}` : MD_CLASS}
        components={MD_COMPONENTS}
        plugins={MD_PLUGINS}
        controls={MD_CONTROLS}
        shikiTheme={SHIKI_THEMES}
        lineNumbers={false}
        mode={streaming ? "streaming" : "static"}
        parseIncompleteMarkdown={streaming}
        animated={false}
    >
        {content}
    </Streamdown>
)

const MemoMarkdown = memo(Markdown)

/**
 * Markdown whose text is revealed on the frame clock ({@link useTypewriter}) rather than in one
 * lump per commit. Owning the per-frame state HERE keeps it out of `AgentMessage`, which regroups
 * every part on each render.
 *
 * `streaming` stays on until the reveal has drained, not until the stream ends — the visible text
 * is a truncated prefix, so healing must outlive the last delta or a half-written fence renders
 * raw for the last frames of every turn.
 */
export const StreamingMarkdown = ({
    content,
    className,
    streaming = false,
    urgent = false,
}: {
    content: string
    className?: string
    /** The part is still receiving text. */
    streaming?: boolean
    /** The part is no longer last: finish fast so a tool card below never outruns its prose. */
    urgent?: boolean
}) => {
    const {text, settled} = useTypewriter(content, {urgent})
    return <MemoMarkdown content={text} className={className} streaming={streaming || !settled} />
}

export default MemoMarkdown
