import type {ComponentType} from "react"

export interface DriveCodeBlockProps {
    language: string
    value: string
}

/**
 * The syntax-highlighted code viewer the file preview uses.
 *
 * Injected for the same reason as the markdown renderer, plus one of its own: the desktop's is
 * Lexical + lazy-Shiki, an ~8.7 MB chunk that must stay out of any host that does not open code
 * files. Unregistered hosts fall back to plain preformatted text.
 */
let codeBlockRenderer: ComponentType<DriveCodeBlockProps> | null = null

export const registerDriveCodeBlock = (component: ComponentType<DriveCodeBlockProps>): void => {
    codeBlockRenderer = component
}

export const DriveCodeBlock = ({language, value}: DriveCodeBlockProps) => {
    const Renderer = codeBlockRenderer
    if (Renderer) return <Renderer language={language} value={value} />
    return <pre className="whitespace-pre-wrap break-words text-xs">{value}</pre>
}

export interface DriveMarkdownProps {
    content: string
    className?: string
}

/**
 * The markdown renderer the file preview uses.
 *
 * Injected rather than imported: the desktop renders its chat Markdown component (Lexical/Prism
 * chrome and all), and another host may render its own. Registered once at startup; until then a
 * preview falls back to plain preformatted text rather than failing to render.
 */
let markdownRenderer: ComponentType<DriveMarkdownProps> | null = null

export const registerDriveMarkdown = (component: ComponentType<DriveMarkdownProps>): void => {
    markdownRenderer = component
}

export const DriveMarkdown = ({content, className}: DriveMarkdownProps) => {
    const Renderer = markdownRenderer
    if (Renderer) return <Renderer content={content} className={className} />
    return (
        <pre className={`whitespace-pre-wrap break-words text-xs ${className ?? ""}`}>
            {content}
        </pre>
    )
}
