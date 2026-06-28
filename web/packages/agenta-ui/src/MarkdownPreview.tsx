/**
 * MarkdownPreview
 *
 * A lightweight read-only Markdown renderer (marked + DOMPurify) for previews and summaries — no
 * Lexical editor instance, so it's cheap to mount many of. Element styling is applied with Tailwind
 * arbitrary-variant classes (the `@agenta/ui` source is in the app's tailwind content globs).
 */
import {useMemo} from "react"

import DOMPurify from "dompurify"
import {marked} from "marked"

export interface MarkdownPreviewProps {
    content: string
    className?: string
}

// "Option B — comfortable" prose styling for rendered Markdown, kept in sync with the document
// editor's `.md-prose` rules in editor-theme.css. Uses antd semantic tokens so it adapts to dark
// mode. (This renderer is for inline summaries/previews; the drawer's edit + preview panes render
// through the Lexical editor and pick up the `.md-prose` CSS instead.)
const MD_CLASS = [
    "text-[13px] leading-[1.6] text-[var(--ant-color-text)]",
    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
    "[&_h1]:text-[20px] [&_h1]:font-semibold [&_h1]:mt-[18px] [&_h1]:mb-1.5 [&_h1]:leading-tight",
    "[&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1.5",
    "[&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:mt-3.5 [&_h3]:mb-1",
    "[&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-[var(--ant-color-text-secondary)]",
    "[&_p]:my-2",
    "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
    // Per-depth list markers, matching the editor + the Lexical playground (1 → A → a, • → ◦ → ▪).
    "[&_ol_ol]:list-[upper-alpha] [&_ol_ol_ol]:list-[lower-alpha] [&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square]",
    "[&_a]:text-[var(--ant-color-primary)] [&_a]:underline",
    "[&_code]:font-mono [&_code]:text-[0.86em] [&_code]:bg-[var(--ant-color-fill-tertiary)] [&_code]:border [&_code]:border-solid [&_code]:border-[var(--ant-color-border-secondary)] [&_code]:rounded [&_code]:px-1.5 [&_code]:py-px",
    "[&_pre]:my-2.5 [&_pre]:bg-[var(--ant-color-fill-quaternary)] [&_pre]:border [&_pre]:border-solid [&_pre]:border-[var(--ant-color-border-secondary)] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto",
    "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px]",
    "[&_blockquote]:my-2.5 [&_blockquote]:border-0 [&_blockquote]:border-l-[3px] [&_blockquote]:border-solid [&_blockquote]:border-[var(--ant-color-border)] [&_blockquote]:pl-3.5 [&_blockquote]:italic [&_blockquote]:text-[var(--ant-color-text-secondary)]",
    "[&_table]:my-2.5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
    "[&_th]:border-0 [&_th]:border-b [&_th]:border-solid [&_th]:border-[var(--ant-color-border)] [&_th]:bg-[var(--ant-color-fill-tertiary)] [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium",
    "[&_td]:border-0 [&_td]:border-b [&_td]:border-solid [&_td]:border-[var(--ant-color-border-secondary)] [&_td]:px-2.5 [&_td]:py-1.5",
].join(" ")

export function MarkdownPreview({content, className}: MarkdownPreviewProps) {
    const html = useMemo(() => {
        if (!content?.trim()) return ""
        // DOMPurify needs a DOM, so it can't sanitize on the server. Rather than emit the raw
        // `marked` output into SSR markup (user-authored content → stored XSS), render nothing on
        // the server and let the client produce the sanitized HTML. This component only renders in
        // client surfaces and its content is client-loaded, so there's no real content to lose.
        if (typeof window === "undefined") return ""
        const raw = marked.parse(content, {async: false, gfm: true, breaks: true}) as string
        return DOMPurify.sanitize(raw)
    }, [content])

    if (!html) return null

    return (
        <div
            className={[MD_CLASS, className].filter(Boolean).join(" ")}
            dangerouslySetInnerHTML={{__html: html}}
        />
    )
}
