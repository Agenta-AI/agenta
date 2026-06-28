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

// Compact prose styling for rendered Markdown elements.
const MD_CLASS = [
    "text-xs leading-relaxed",
    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
    "[&_h1]:text-sm [&_h1]:font-medium [&_h2]:text-xs [&_h2]:font-medium [&_h3]:text-xs [&_h3]:font-medium",
    "[&_p]:my-1",
    "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5",
    "[&_a]:text-[var(--ag-c-1677FF)] [&_a]:underline",
    "[&_code]:font-mono [&_code]:text-[0.9em]",
    "[&_blockquote]:border-l-2 [&_blockquote]:border-solid [&_blockquote]:border-[var(--ag-c-EAEFF5)] [&_blockquote]:pl-2 [&_blockquote]:text-[var(--ag-c-97A4B0)]",
    "[&_pre]:overflow-x-auto",
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
