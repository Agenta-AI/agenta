import {useState} from "react"

import {MarkdownEditor} from "@agenta/entity-ui/drill-in"
import {MarkdownPreview} from "@agenta/ui"
import {cn} from "@agenta/ui/styles"

/** One bordered markdown box: the formatting tools on top of the text; read-only shows the rendered text. */
export function SkillMarkdownFrame({
    value,
    onChange,
    placeholder,
    empty,
    readOnly = false,
    invalid = false,
}: {
    value: string
    onChange: (next: string) => void
    placeholder: string
    /** What Preview shows when there is no text. */
    empty: string
    readOnly?: boolean
    invalid?: boolean
}) {
    const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
    const writing = !readOnly

    return (
        <div
            className={cn(
                "md-doc flex min-w-0 flex-col rounded-lg border border-solid",
                invalid ? "border-destructive" : "border-border-muted",
            )}
        >
            {writing ? (
                <div
                    ref={setToolbarHost}
                    className="flex min-h-10 min-w-0 items-center overflow-x-auto border-0 border-b border-solid border-border-muted px-2 [scrollbar-width:none]"
                />
            ) : null}
            {writing ? (
                <div className="flex min-h-[280px] flex-col [&_.md-prose]:min-h-[280px]">
                    <MarkdownEditor
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder}
                        showToolbar
                        toolbarContainer={toolbarHost}
                        toolbarLayout="inline"
                        bordered={false}
                        defaultView="rendered"
                        hideHeader
                    />
                </div>
            ) : value.trim() ? (
                <div className="px-4 py-3">
                    <MarkdownPreview content={value} />
                </div>
            ) : (
                <p className="m-0 px-4 py-6 text-center text-label text-muted-foreground">{empty}</p>
            )}
        </div>
    )
}
