import {memo, type ReactNode} from "react"

import {CopyButton} from "@agenta/ui/components/presentational"
import {XMarkdown} from "@ant-design/x-markdown"
import Latex from "@ant-design/x-markdown/plugins/Latex"
import {Tooltip} from "antd"
import {useAtomValue} from "jotai"
import {PrismAsync as SyntaxHighlighter} from "react-syntax-highlighter"
import {oneDark} from "react-syntax-highlighter/dist/esm/styles/prism"

import {useDriveSessionId} from "@/oss/components/Drives/driveSessionContext"

import {chatFileLinkAtomFamily} from "../state/fileLinks"

// Dark-mode-aware markdown styling. `min-w-0` + `max-w-full` + the per-element width guards
// keep long lines / code blocks from widening their container; code blocks scroll within their
// own box instead. XMarkdown ships NO default element CSS, so every block we want styled is
// listed here explicitly.
export const MD_CLASS =
    "min-w-0 max-w-full overflow-hidden break-words text-sm leading-relaxed " +
    "[&_a]:text-colorPrimary [&_a]:underline [&_a]:break-all [&_p]:my-1 [&_p]:break-words " +
    "[&_ul]:my-1 [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:rounded " +
    "[&_code]:bg-colorFillTertiary [&_code]:px-1 [&_code]:break-words [&_pre]:bg-colorFillTertiary " +
    "[&_pre]:p-2 [&_pre]:rounded [&_pre]:max-w-full [&_pre]:min-w-0 [&_pre]:overflow-x-auto " +
    // Tables: real borders + padding, a quiet header, and `break-normal` cells so text wraps at
    // spaces instead of snapping mid-word ("PostH og"). Full-width within the bubble.
    "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs " +
    "[&_th]:border [&_th]:border-solid [&_th]:border-colorBorderSecondary [&_th]:bg-colorFillTertiary " +
    "[&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:align-top [&_th]:font-medium [&_th]:break-normal " +
    "[&_td]:border [&_td]:border-solid [&_td]:border-colorBorderSecondary " +
    "[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_td]:break-normal " +
    // Headings — compact for a chat bubble (browser defaults are huge), descending weight/size.
    // Colour is `text-inherit`, NOT a fixed token: a global bare-`h1 { color:#333 }` rule
    // (editor-theme.css) leaks into every unstyled h1 and preflight is off so nothing normalises
    // it. `inherit` out-specifies that global rule (0,1,1 vs 0,0,1) and makes headings follow the
    // block's own colour — correct on any surface AND respecting a caller/ancestor recolour (e.g.
    // a muted context). Same guard on h2–h5 future-proofs against another stray global heading
    // rule; h6 stays intentionally quieter.
    "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:leading-snug [&_h1]:text-inherit " +
    "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:text-inherit " +
    "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-inherit " +
    "[&_h4]:mt-2 [&_h4]:mb-0.5 [&_h4]:text-xs [&_h4]:font-semibold [&_h4]:text-inherit " +
    "[&_h5]:mt-2 [&_h5]:mb-0.5 [&_h5]:text-xs [&_h5]:font-semibold [&_h5]:text-inherit " +
    "[&_h6]:mt-2 [&_h6]:mb-0.5 [&_h6]:text-xs [&_h6]:font-medium [&_h6]:text-colorTextSecondary " +
    // Blockquote — a quiet left-ruled aside. Layout is forced (!important) so nothing (the UA's
    // logical `margin-inline: 40px`, the Bubble's placement styles, etc.) can push the content into
    // a centered/over-indented look: no horizontal margin, a small left padding, left-aligned.
    // Zero the non-left borders with per-side longhands (NOT `border-0`, whose `border-width`
    // shorthand wins over `border-l-2` as an arbitrary variant and drops the left rule).
    "[&_blockquote]:my-2 [&_blockquote]:!mx-0 [&_blockquote]:!pl-3 [&_blockquote]:!text-left " +
    "[&_blockquote]:border-y-0 [&_blockquote]:border-r-0 [&_blockquote]:border-l-2 " +
    "[&_blockquote]:border-solid [&_blockquote]:border-colorTextTertiary " +
    "[&_blockquote]:text-colorTextSecondary [&_blockquote]:italic " +
    // Rule, images, emphasis, strikethrough, and task-list checkboxes.
    "[&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-solid [&_hr]:border-colorBorderSecondary " +
    "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded " +
    "[&_strong]:font-semibold [&_em]:italic [&_del]:line-through " +
    // HTML passthrough (LLM output sometimes includes raw HTML): neutralise the elements whose UA
    // defaults are jarring with preflight off — <mark> (bright yellow bg) → a subtle theme
    // highlight, <kbd> → a keycap. <sub>/<sup> UA styling (position only) is already fine.
    "[&_mark]:rounded [&_mark]:bg-colorFillTertiary [&_mark]:px-0.5 [&_mark]:text-inherit " +
    "[&_kbd]:rounded [&_kbd]:border [&_kbd]:border-solid [&_kbd]:border-colorBorderSecondary " +
    "[&_kbd]:bg-colorFillTertiary [&_kbd]:px-1 [&_kbd]:font-mono [&_kbd]:text-[0.9em] " +
    "[&_li:has(input)]:list-none [&_input]:mr-1.5 [&_input]:align-middle " +
    // Trim the outer edges so the bubble padding isn't doubled by leading/trailing margins.
    "[&>:first-child]:!mt-0 [&>:last-child]:!mb-0"

/** Math support ($…$ / $$…$$) via KaTeX — registered once as a marked extension. */
const LATEX_CONFIG = {extensions: Latex()}

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

/**
 * Code renderer: inline `code` keeps the styled chip (file-aware, see {@link InlineCode}); a
 * fenced block gets Prism syntax highlighting (language-on-demand via PrismAsync, oneDark theme).
 * XMarkdown supplies `block` and `lang` (the fence info string) so we don't have to parse
 * `className`.
 */
const CodeBlock = ({
    block,
    lang,
    className,
    children,
}: {
    block?: boolean
    lang?: string
    className?: string
    children?: ReactNode
}) => {
    if (!block) return <InlineCode className={className}>{children}</InlineCode>

    const code = childrenToText(children).replace(/\n$/, "")

    return (
        <div className="relative min-w-0 max-w-full">
            <div className="absolute top-3 right-2 z-10">
                <Tooltip title="Copy code">
                    <CopyButton
                        text={code}
                        buttonText={null}
                        icon
                        size="small"
                        aria-label="Copy code"
                        successMessage=""
                        className="!h-7 !w-7 !border-colorBorderSecondary !bg-colorBgElevated !p-0 !text-colorTextSecondary shadow-sm"
                    />
                </Tooltip>
            </div>
            <SyntaxHighlighter
                language={(lang || "text").trim().split(/\s+/)[0] || "text"}
                style={oneDark}
                PreTag="div"
                customStyle={{
                    margin: "0.5rem 0",
                    padding: "0.75rem",
                    paddingRight: "2.75rem",
                    borderRadius: 6,
                    fontSize: "0.75rem",
                }}
                // Reset the inline-code chip styles MD_CLASS's `[&_code]` applies: the block's own
                // <code> is inline (white-space:pre), so a chip background breaks per line and looks
                // like every line is highlighted. Inline style wins over the utility class.
                codeTagProps={{
                    style: {fontSize: "0.75rem", background: "transparent", padding: 0},
                }}
            >
                {code}
            </SyntaxHighlighter>
        </div>
    )
}

/** Unwrap the markdown `<pre>` — the highlighted block owns its own container. */
const PreUnwrap = ({children}: {children?: ReactNode}) => <>{children}</>

/** Stable `components` map: a fresh object literal per render churns XMarkdown's prop identity, and
 * this renderer re-renders on every throttled streaming token — so hoist it to a module constant. */
const MD_COMPONENTS = {code: CodeBlock, pre: PreUnwrap}

/** Shared markdown renderer for the slice — used by message bubbles and the composer live
 * preview, so both render identically. `className` appends to `MD_CLASS` so callers can tweak
 * size/color (e.g. the muted reasoning block) without forking the renderer.
 *
 * Memoized on `content`/`className`: within the one message that re-renders per streamed token
 * (the streaming one), its already-settled parts — a reasoning block, text before a tool call —
 * keep the same `content` string, so this skips re-parsing + re-running Prism on them each token.
 * (Settled messages don't re-render at all; the stable-`onRewind` fix handles those.) */
// Anchor component ensures all markdown-rendered links open in a new tab safely.
// Only forward real anchor attributes — XMarkdown/html-react-parser also pass internal
// props (`domNode`, `node`, `streamStatus`, …) that would leak onto the DOM element.
const Anchor = ({href, children, title, className}: any) => (
    <a href={href} title={title} className={className} target="_blank" rel="noopener noreferrer">
        {children}
    </a>
)

const Markdown = ({content, className}: {content: string; className?: string}) => (
    <XMarkdown
        className={className ? `${MD_CLASS} ${className}` : MD_CLASS}
        content={content}
        config={LATEX_CONFIG}
        components={{...MD_COMPONENTS, a: Anchor}}
    />
)

export default memo(Markdown)
