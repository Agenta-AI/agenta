import {useTypewriter} from "@agenta/chat/hooks"
import {Streamdown, type Components} from "streamdown"

/**
 * Streamdown ships `rehype-raw → rehype-sanitize (GitHub's default schema) → rehype-harden`
 * as its default rehype pipeline, so raw HTML in model output is parsed but stripped down to
 * the safe subset (no `<script>`/`<style>`/`<iframe>`, no `on*` handlers, no `javascript:`
 * URLs). We deliberately pass no `rehypePlugins` and no `allowedTags` so that default stands.
 */
const markdownComponents: Components = {
    // Streamdown's own anchor already sets target=_blank + rel=noreferrer; make the
    // opener-severing explicit so the guarantee survives an upstream refresh.
    a: ({node: _node, className, ...props}) => (
        <a
            {...props}
            className={`text-primary font-medium underline ${className ?? ""}`}
            rel="noopener noreferrer"
            target="_blank"
        />
    ),
}

/**
 * Streamdown's built-in classes assume a 14–30px type scale; the mobile app's base is 12px.
 * Descendant selectors (specificity 0,2,0+) win over its own single-class utilities without
 * having to fork every element renderer. Semantic tokens only — the `sidebar` role Streamdown
 * reaches for is not part of the generated token bridge, so code/table chrome is re-surfaced
 * onto `muted`, and long unbroken tokens wrap instead of widening the viewport.
 */
const proseClassName = [
    "w-full min-w-0 space-y-2 overflow-hidden text-xs wrap-anywhere",
    "[&_p]:text-foreground [&_p]:text-xs",
    "[&_:is(h1,h2,h3,h4,h5,h6)]:mt-3 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-1",
    "[&_h1]:text-base [&_:is(h2,h3)]:text-sm [&_:is(h4,h5,h6)]:text-xs",
    "[&_:is(ul,ol)]:my-1 [&_li]:py-0.5 [&_li]:text-xs",
    "[&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote_p]:text-muted-foreground",
    "[&_hr]:my-3",
    "[&_code]:text-[0.95em]",
    "[&_:is(th,td)]:px-2 [&_:is(th,td)]:py-1 [&_:is(th,td)]:text-xs",
    "[&_[data-streamdown=code-block]]:bg-muted [&_[data-streamdown=code-block]]:rounded-md",
    "[&_[data-streamdown=code-block-actions]]:bg-muted",
    "[&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-2 [&_[data-streamdown=code-block-body]]:text-xs",
    "[&_[data-streamdown=table-wrapper]]:bg-muted",
].join(" ")

/**
 * Assistant message text rendered as markdown (desktop parity). User text stays literal.
 *
 * Text is revealed on the frame clock, so incomplete-markdown repair has to outlive the last
 * delta — until the reveal drains, what is on screen is a truncated prefix.
 */
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
    const healing = streaming || !settled
    return (
        <Streamdown
            animated={false}
            className={proseClassName}
            components={markdownComponents}
            controls={{code: {copy: true, download: false}, mermaid: false, table: false}}
            lineNumbers={false}
            mode={healing ? "streaming" : "static"}
            parseIncompleteMarkdown={healing}
        >
            {revealed}
        </Streamdown>
    )
}
