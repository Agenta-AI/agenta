import {createContext, memo, useContext, type ReactNode} from "react"

import {code} from "@streamdown/code"
import {math} from "@streamdown/math"
import {Streamdown, type Components, type ThemeInput} from "streamdown"

/** Host-supplied renderer for a code span / relative href that may name an agent file. */
export interface ChatMarkdownLinkResolver {
    /** Render `value` as a file link when it resolves, else `fallback`; may resolve asynchronously. */
    renderCode: (value: string, fallback: ReactNode) => ReactNode
}

/** Hook the host passes in to publish its resolver; returns null when no drive is mounted. */
export type UseChatMarkdownLinkResolver = () => ChatMarkdownLinkResolver | null

// Context (not a prop) so the components map below can stay module-scope and identity-stable.
const LinkResolverContext = createContext<UseChatMarkdownLinkResolver | null>(null)

/**
 * Token-free structural rules every surface needs. Streamdown emits one <span> per Shiki line but
 * only classes it (with `display:block`) when `lineNumbers` is on, so with numbers off every line
 * ran together ("a = 1b = 2c = 3"); make the line spans blocks ourselves.
 */
export const CHAT_MARKDOWN_STRUCTURAL_CLASS =
    "[&_[data-streamdown=code-block]_pre_code>span]:!block"

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

// Split out so the host hook is called unconditionally, and only where a resolver can apply.
const ResolvedSpan = ({
    useResolver,
    value,
    fallback,
}: {
    useResolver: UseChatMarkdownLinkResolver
    value: string
    fallback: ReactNode
}) => {
    const link = useResolver()
    return <>{link ? link.renderCode(value, fallback) : fallback}</>
}

/** Inline code chip; a resolver may turn a file-naming span into a compact inline file reference. */
const InlineCode = ({className, children}: {className?: string; children?: ReactNode}) => {
    const useResolver = useContext(LinkResolverContext)
    const text = childrenToText(children).trim()
    const fallback = <code className={className}>{children}</code>
    if (!useResolver || !text) return fallback
    return <ResolvedSpan useResolver={useResolver} value={text} fallback={fallback} />
}

/** Any `scheme:` URL, protocol-relative `//host`, or in-page `#fragment` stays a plain link. */
const isExternalHref = (href?: string): boolean =>
    !href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)

/** Only real anchor attributes — Streamdown also passes renderer internals we must not spread. */
interface AnchorProps {
    href?: string
    title?: string
    className?: string
    children?: ReactNode
}

/** Plain link, opened in a new tab; also the fallback when a relative href isn't a known file. */
const ExternalLink = ({href, title, className, children}: AnchorProps) => (
    <a href={href} title={title} className={className} target="_blank" rel="noopener noreferrer">
        {children}
    </a>
)

/** A relative href may NAME a file — resolve it through the same resolver inline code uses. */
const DriveLink = ({href, ...rest}: AnchorProps) => {
    const useResolver = useContext(LinkResolverContext)
    // A slash-prefixed href is a sandbox path, not a web URL: keep it inert rather than navigating.
    const fallback = href?.startsWith("/") ? (
        <>{rest.children}</>
    ) : (
        <ExternalLink href={href} {...rest} />
    )
    if (!useResolver || !href) return fallback
    return <ResolvedSpan useResolver={useResolver} value={href} fallback={fallback} />
}

/** Split so an ordinary URL costs nothing: only a relative href subscribes to the resolver. */
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

/** Module-scope: fresh literals would churn Streamdown's prop identity on every streamed token. */
const MD_COMPONENTS: Components = {
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

/** Copy button on fences; no per-table/mermaid chrome. */
const MD_CONTROLS = {code: {copy: true, download: false}, mermaid: false, table: false} as const

/** Light/dark pair — Shiki dual themes track the app theme. */
const SHIKI_THEMES: [ThemeInput, ThemeInput] = ["one-light", "one-dark-pro"]

export interface ChatMarkdownProps {
    content: string
    /** Typography + token layer owned by the host surface (antd on desktop, shadcn on mobile). */
    baseClassName: string
    /** Per-call-site tweak appended after `baseClassName`. */
    className?: string
    /** Text is still growing or still being revealed: keep incomplete-markdown healing on. */
    streaming?: boolean
    /** Without it, code spans and relative links render plain. */
    useLinkResolver?: UseChatMarkdownLinkResolver
}

/**
 * Shared agent-chat markdown renderer for desktop and mobile. Presentational only — the typing
 * reveal (`useTypewriter`) stays with each host so it is never applied twice.
 *
 * Sanitization is Streamdown's default rehype pipeline (`rehype-raw → rehype-sanitize (GitHub
 * schema) → rehype-harden`): document-affecting tags, handlers, and javascript: URLs are stripped.
 *
 * Memoized on props so settled parts of a streaming message skip re-parsing on every token.
 */
const ChatMarkdown = ({
    content,
    baseClassName,
    className,
    streaming = false,
    useLinkResolver,
}: ChatMarkdownProps) => (
    <LinkResolverContext.Provider value={useLinkResolver ?? null}>
        <Streamdown
            className={[CHAT_MARKDOWN_STRUCTURAL_CLASS, baseClassName, className]
                .filter(Boolean)
                .join(" ")}
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
    </LinkResolverContext.Provider>
)

export default memo(ChatMarkdown)
