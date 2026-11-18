import type {RefObject} from "react"

import {cn} from "@agenta/ui/styles"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {
    Code,
    LinkSimple,
    ListBullets,
    ListNumbers,
    TextB,
    TextHTwo,
    TextItalic,
} from "@phosphor-icons/react"

type Format = "heading" | "bold" | "italic" | "bullets" | "numbers" | "link" | "code"

const LINE_PREFIX: Partial<Record<Format, string>> = {
    heading: "## ",
    bullets: "- ",
    numbers: "1. ",
}
const WRAP: Partial<Record<Format, [string, string, string]>> = {
    bold: ["**", "**", "bold text"],
    italic: ["_", "_", "italic text"],
    code: ["`", "`", "code"],
    link: ["[", "](https://)", "link text"],
}

/** Applies one markdown format to the textarea's selection and returns the new value. */
export function applyMarkdownFormat(
    area: HTMLTextAreaElement,
    format: Format,
): {value: string; start: number; end: number} {
    const {value, selectionStart: start, selectionEnd: end} = area
    const prefix = LINE_PREFIX[format]
    if (prefix) {
        const lineStart = value.lastIndexOf("\n", start - 1) + 1
        const next = value.slice(0, lineStart) + prefix + value.slice(lineStart)
        return {value: next, start: start + prefix.length, end: end + prefix.length}
    }
    const [open, close, fallback] = WRAP[format] ?? ["", "", ""]
    const selected = value.slice(start, end) || fallback
    const next = value.slice(0, start) + open + selected + close + value.slice(end)
    return {value: next, start: start + open.length, end: start + open.length + selected.length}
}

const TOOLS: {format: Format; label: string; icon: React.ReactNode; gapBefore?: boolean}[] = [
    {format: "heading", label: "Heading", icon: <TextHTwo size={15} />},
    {format: "bold", label: "Bold", icon: <TextB size={15} weight="bold" />},
    {format: "italic", label: "Italic", icon: <TextItalic size={15} />},
    {format: "bullets", label: "Bulleted list", icon: <ListBullets size={15} />, gapBefore: true},
    {format: "numbers", label: "Numbered list", icon: <ListNumbers size={15} />},
    {format: "link", label: "Link", icon: <LinkSimple size={15} />, gapBefore: true},
    {format: "code", label: "Code", icon: <Code size={15} />},
]

export function MarkdownToolbar({
    target,
    onChange,
    className,
}: {
    target: RefObject<HTMLTextAreaElement | null>
    onChange: (value: string) => void
    className?: string
}) {
    const run = (format: Format) => {
        const area = target.current
        if (!area) return
        const next = applyMarkdownFormat(area, format)
        onChange(next.value)
        requestAnimationFrame(() => {
            area.focus()
            area.setSelectionRange(next.start, next.end)
        })
    }
    return (
        <TooltipProvider>
            <div
                role="toolbar"
                aria-label="Formatting"
                className={cn("flex items-center gap-0.5", className)}
            >
                {TOOLS.map((tool) => (
                    <span key={tool.format} className="flex items-center">
                        {tool.gapBefore ? (
                            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
                        ) : null}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={tool.label}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => run(tool.format)}
                                    className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                    {tool.icon}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">{tool.label}</TooltipContent>
                        </Tooltip>
                    </span>
                ))}
            </div>
        </TooltipProvider>
    )
}
