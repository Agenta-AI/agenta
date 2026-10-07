import {
    createContext,
    isValidElement,
    memo,
    useContext,
    useLayoutEffect,
    useState,
    useSyncExternalStore,
    type ComponentProps,
    type ReactNode,
} from "react"

import {
    BlockedChatLink,
    decodeDriveHref,
    isExternalHref,
    isProtocolRelativeHref,
    withExplicitRelativeLinks,
} from "@agenta/entity-ui/drive"
import {HoverCard, HoverCardContent, HoverCardTrigger} from "@agenta/ui/ui"
import {createCodePlugin, type CodeHighlighterPlugin} from "@streamdown/code"
import {math} from "@streamdown/math"
import {
    defaultRehypePlugins,
    Streamdown,
    type Components,
    type IconMap,
    type ThemeInput,
} from "streamdown"

import LinkPreviewCard from "./LinkPreviewCard"

/** Host-supplied renderer for a code span / relative href that may name an agent file. */
export interface ChatMarkdownLinkResolver {
    /** Render `value` as a file link when it resolves, else `fallback`; may resolve asynchronously. */
    renderCode: (value: string, fallback: ReactNode) => ReactNode
    /** Block content to place under a paragraph or list item for the code spans and relative
     * hrefs it names; each value goes to its first mention in the message only. */
    renderFollowUps?: (values: string[]) => ReactNode
}

/** Hook the host passes in to publish its resolver; returns null when no drive is mounted. */
export type UseChatMarkdownLinkResolver = () => ChatMarkdownLinkResolver | null

// Context (not a prop) so the components map below can stay module-scope and identity-stable.
const LinkResolverContext = createContext<UseChatMarkdownLinkResolver | null>(null)

/** Publishes a resolver to {@link chatMarkdownComponents} outside a full `ChatMarkdown` render. */
export const ChatMarkdownLinkResolverProvider = LinkResolverContext.Provider

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

/** Only real anchor attributes — Streamdown also passes renderer internals we must not spread. */
interface AnchorProps {
    href?: string
    title?: string
    className?: string
    children?: ReactNode
}

const isWebHref = (href?: string): href is string => Boolean(href && /^https?:\/\//i.test(href))

/** Plain link, opened in a new tab; also the fallback when a relative href isn't a known file. A
 * web link previews its page on hover. */
const ExternalLink = ({href, title, className, children}: AnchorProps) => {
    const link = (
        <a
            href={href}
            title={title}
            className={className}
            target="_blank"
            rel="noopener noreferrer"
        >
            {children}
        </a>
    )
    if (!isWebHref(href)) return link
    return (
        <HoverCard openDelay={300} closeDelay={150}>
            <HoverCardTrigger asChild>{link}</HoverCardTrigger>
            <HoverCardContent
                side="top"
                align="start"
                sideOffset={6}
                collisionPadding={8}
                className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0 text-xs"
            >
                <LinkPreviewCard href={href} />
            </HoverCardContent>
        </HoverCard>
    )
}

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
    // Harden percent-encodes the href through `new URL()`; drive paths are raw.
    return (
        <ResolvedSpan useResolver={useResolver} value={decodeDriveHref(href)} fallback={fallback} />
    )
}

/** Split so an ordinary URL costs nothing: only a relative href subscribes to the resolver.
 *
 * The host check runs FIRST, on the raw href, before anything here can normalise or decode it. A
 * target that names a host is refused outright and rendered the way harden renders the targets it
 * refuses (#6666); nothing downstream ever sees it. */
const Anchor = ({href, title, className, children}: AnchorProps) =>
    isProtocolRelativeHref(href) ? (
        <BlockedChatLink href={href} className={className}>
            {children}
        </BlockedChatLink>
    ) : isExternalHref(href) ? (
        <ExternalLink href={href} title={title} className={className}>
            {children}
        </ExternalLink>
    ) : (
        <DriveLink href={href} title={title} className={className}>
            {children}
        </DriveLink>
    )

/** The slice of a hast element the follow-up scan reads. */
interface HastNode {
    type: string
    tagName?: string
    value?: string
    properties?: {href?: unknown}
    children?: HastNode[]
}

/** Children that are blocks of their own: a nested paragraph or list scans itself. */
const BLOCK_TAGS = new Set(["p", "ul", "ol", "pre", "blockquote", "table", "div"])

const hastText = (node: HastNode): string =>
    node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(hastText).join("")

/** The code spans and relative hrefs a paragraph or list item names, in order, once each. */
const mentionsIn = (node: HastNode, out = new Set<string>()): Set<string> => {
    for (const child of node.children ?? []) {
        if (child.type !== "element" || BLOCK_TAGS.has(child.tagName ?? "")) continue
        if (child.tagName === "code") {
            const text = hastText(child).trim()
            if (text) out.add(text)
            continue
        }
        if (child.tagName === "a") {
            // The href is the anchor's mention; its label (often the same name as code) is not.
            const href = child.properties?.href
            if (typeof href === "string" && !isProtocolRelativeHref(href) && !isExternalHref(href))
                out.add(decodeDriveHref(href))
            continue
        }
        mentionsIn(child, out)
    }
    return out
}

/**
 * Which follow-up block owns each value: the first in document order. Blocks register from a
 * layout effect, so a render that never commits claims nothing, and order is read from the DOM
 * because a streamed message is parsed block by block, with no shared source offsets.
 */
/** `./chart.png`, `/chart.png` and `chart.png` claim as one name. */
const claimKey = (value: string) => value.replace(/^(?:\.\/|\/)+/, "")

class FollowUpClaims {
    private blocks = new Map<Element, string[]>()
    private listeners = new Set<() => void>()
    private version = 0
    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        return () => void this.listeners.delete(listener)
    }
    getVersion = () => this.version
    set(block: Element, values: string[] | null) {
        if (values) this.blocks.set(block, values.map(claimKey))
        else this.blocks.delete(block)
        this.version += 1
        this.listeners.forEach((listener) => listener())
    }
    owns(block: Element, value: string): boolean {
        const key = claimKey(value)
        for (const [other, keys] of this.blocks) {
            if (other === block || !keys.includes(key)) continue
            if (other.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)
                return false
        }
        return this.blocks.has(block)
    }
}

const FollowUpClaimsContext = createContext<FollowUpClaims | null>(null)

/** The values this block owns, rendered by the host. `display: contents`, so the prose's sibling
 * spacing never sees an empty block. */
const ClaimedFollowUps = ({
    values,
    render,
}: {
    values: string[]
    render: (values: string[]) => ReactNode
}) => {
    const claims = useContext(FollowUpClaimsContext)
    const [block, setBlock] = useState<HTMLDivElement | null>(null)
    const key = JSON.stringify(values)
    useLayoutEffect(() => {
        if (!block || !claims) return
        claims.set(block, JSON.parse(key) as string[])
        return () => claims.set(block, null)
    }, [block, claims, key])
    useSyncExternalStore(
        claims?.subscribe ?? noopSubscribe,
        claims?.getVersion ?? zero,
        claims?.getVersion ?? zero,
    )
    const owned = block && claims ? values.filter((value) => claims.owns(block, value)) : []
    return (
        <div ref={setBlock} className="contents">
            {owned.length ? render(owned) : null}
        </div>
    )
}

const noopSubscribe = () => () => undefined
const zero = () => 0

// Split out so the host hook is called unconditionally, and claims are made only where it renders.
const ResolvedFollowUps = ({
    useResolver,
    values,
}: {
    useResolver: UseChatMarkdownLinkResolver
    values: string[]
}) => {
    const render = useResolver()?.renderFollowUps
    return render ? <ClaimedFollowUps values={values} render={render} /> : null
}

/** Follow-ups for one block, only where the host's resolver renders them. */
const FollowUps = ({node}: {node?: unknown}) => {
    const useResolver = useContext(LinkResolverContext)
    if (!useResolver || !node) return null
    const values = [...mentionsIn(node as HastNode)]
    if (!values.length) return null
    return <ResolvedFollowUps useResolver={useResolver} values={values} />
}

type BlockProps<T extends "p" | "li"> = ComponentProps<T> & {node?: unknown}

interface Position {
    start?: {line?: number; column?: number}
    end?: {line?: number; column?: number}
}

/** Streamdown's block memo (class + source span), so a streamed token re-renders only its block. */
const sameBlock = (
    a: {className?: string; node?: unknown},
    b: {className?: string; node?: unknown},
) => {
    if (a.className !== b.className) return false
    const pa = (a.node as {position?: Position} | undefined)?.position
    const pb = (b.node as {position?: Position} | undefined)?.position
    if (!pa || !pb) return !pa && !pb
    return (
        pa.start?.line === pb.start?.line &&
        pa.start?.column === pb.start?.column &&
        pa.end?.line === pb.end?.line &&
        pa.end?.column === pb.end?.column
    )
}

/** Streamdown's paragraph, plus the follow-ups for what it names. A lone image or code block is
 * unwrapped, as Streamdown's own paragraph does: neither belongs inside a `<p>`. */
const Paragraph = memo(({node, children, ...rest}: BlockProps<"p">) => {
    const kids = (Array.isArray(children) ? children : [children]).filter(
        (child) => child != null && child !== "",
    )
    if (kids.length === 1 && isValidElement(kids[0])) {
        const props = kids[0].props as {node?: HastNode}
        const tag = props.node?.tagName
        if (tag === "img" || (tag === "code" && "data-block" in props)) return <>{children}</>
    }
    return (
        <>
            <p {...rest}>{children}</p>
            <FollowUps node={node} />
        </>
    )
}, sameBlock)
Paragraph.displayName = "ChatMarkdownParagraph"

/** Streamdown's list item (same classes), with the follow-ups for its own inline text. */
const ListItem = memo(
    ({node, children, className, ...rest}: BlockProps<"li">) => (
        <li
            className={["py-1 [&>p]:inline", className].filter(Boolean).join(" ")}
            data-streamdown="list-item"
            {...rest}
        >
            {children}
            <FollowUps node={node} />
        </li>
    ),
    sameBlock,
)
ListItem.displayName = "ChatMarkdownListItem"

/** Module-scope: fresh literals would churn Streamdown's prop identity on every streamed token.
 * Exported so the link gates can be asserted without driving a full Streamdown render. */
export const chatMarkdownComponents: Components = {
    inlineCode: ({className, children}) => (
        <InlineCode className={className}>{children}</InlineCode>
    ),
    a: ({href, title, className, children}) => (
        <Anchor href={href} title={title} className={className}>
            {children}
        </Anchor>
    ),
    p: Paragraph,
    li: ListItem,
}

/** Streamdown's own list, plus one plugin BEFORE its harden gate; the prop replaces the defaults. */
export const MD_REHYPE_PLUGINS = withExplicitRelativeLinks(defaultRehypePlugins)

/** Light/dark pair — Shiki dual themes track the app theme. */
const SHIKI_THEMES: [ThemeInput, ThemeInput] = ["one-light", "one-dark-pro"]

/**
 * Fence languages the model writes that Shiki knows under another id. `bundledLanguagesInfo`
 * carries Shiki's own aliases (`sh` → `bash`), but not these, and an unknown id highlights as
 * plain text — an `env` fence rendered every line in one colour.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
    env: "dotenv",
    ".env": "dotenv",
    shell: "bash",
    zsh: "bash",
    console: "bash",
    yml: "yaml",
    jsonc: "json",
}
const aliasLanguage = <T extends string>(language: T): T =>
    (LANGUAGE_ALIASES[language.trim().toLowerCase()] ?? language) as T

/**
 * Shiki fences, themed here rather than through Streamdown's `shikiTheme`: the plugin's own
 * themes win over that prop, so the pre-built `code` export silently kept GitHub's palette.
 * Wrapped so our aliases apply before the plugin decides whether it can highlight at all.
 */
const shiki = createCodePlugin({themes: SHIKI_THEMES})
const code: CodeHighlighterPlugin = {
    ...shiki,
    supportsLanguage: (language) => shiki.supportsLanguage(aliasLanguage(language)),
    highlight: (options, callback) =>
        shiki.highlight({...options, language: aliasLanguage(options.language)}, callback),
}

/** KaTeX math ($…$ / $$…$$) + Shiki-highlighted fences; both tree-shaken plugin packages. */
const MD_PLUGINS = {math, code}

/** Copy button on fences; no per-table/mermaid chrome. */
const MD_CONTROLS = {code: {copy: true, download: false}, mermaid: false, table: false} as const

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
    /** Streamdown's control glyphs (the fence's copy / copied pair); keep at module scope on the host. */
    icons?: Partial<IconMap>
}

/**
 * Shared agent-chat markdown renderer for desktop and mobile. Presentational only — the typing
 * reveal (`useTypewriter`) stays with each host so it is never applied twice.
 *
 * Sanitization is Streamdown's default rehype pipeline (`rehype-raw → rehype-sanitize (GitHub
 * schema) → rehype-harden`): document-affecting tags, handlers, and javascript: URLs are stripped.
 * `Anchor` adds the one gate harden does not apply, on a target that resolves to a host (#6666).
 *
 * Memoized on props so settled parts of a streaming message skip re-parsing on every token.
 */
const ChatMarkdown = ({
    content,
    baseClassName,
    className,
    streaming = false,
    useLinkResolver,
    icons,
}: ChatMarkdownProps) => {
    const [claims] = useState(() => new FollowUpClaims())
    return (
        <LinkResolverContext.Provider value={useLinkResolver ?? null}>
            <FollowUpClaimsContext.Provider value={claims}>
                <Streamdown
                    className={[CHAT_MARKDOWN_STRUCTURAL_CLASS, baseClassName, className]
                        .filter(Boolean)
                        .join(" ")}
                    components={chatMarkdownComponents}
                    rehypePlugins={MD_REHYPE_PLUGINS}
                    plugins={MD_PLUGINS}
                    controls={MD_CONTROLS}
                    icons={icons}
                    shikiTheme={SHIKI_THEMES}
                    lineNumbers={false}
                    mode={streaming ? "streaming" : "static"}
                    parseIncompleteMarkdown={streaming}
                    animated={false}
                >
                    {content}
                </Streamdown>
            </FollowUpClaimsContext.Provider>
        </LinkResolverContext.Provider>
    )
}

export default memo(ChatMarkdown)
