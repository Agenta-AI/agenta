import {MarkdownEditor} from "@agenta/entity-ui/drill-in"
import {MarkdownPreview} from "@agenta/ui"
import {cn} from "@agenta/ui/styles"

/** One bordered markdown box. The formatting tools render into `toolbar`, a slot the host puts in its label row. */
export function SkillMarkdownFrame({
    value,
    onChange,
    placeholder,
    empty,
    readOnly = false,
    invalid = false,
    toolbar,
    fill = false,
}: {
    value: string
    onChange: (next: string) => void
    placeholder: string
    /** What Preview shows when there is no text. */
    empty: string
    readOnly?: boolean
    invalid?: boolean
    /** Where the formatting tools go; null until the host's slot mounts. */
    toolbar: HTMLElement | null
    /** Take the parent's height and scroll inside, instead of growing with the text. */
    fill?: boolean
}) {
    const writing = !readOnly

    return (
        <div
            className={cn(
                "md-doc flex min-w-0 flex-col rounded-lg border border-solid",
                fill && "h-full min-h-0 overflow-hidden",
                invalid ? "border-destructive" : "border-border-muted",
            )}
        >
            {writing ? (
                <div
                    className={cn(
                        "flex flex-col",
                        fill ? "min-h-0 flex-1" : "min-h-[280px] [&_.md-prose]:min-h-[280px]",
                    )}
                >
                    <MarkdownEditor
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder}
                        showToolbar
                        toolbarContainer={toolbar}
                        toolbarLayout="inline"
                        bordered={false}
                        defaultView="rendered"
                        hideHeader
                        grow={fill}
                    />
                </div>
            ) : value.trim() ? (
                <div className={cn("px-4 py-3", fill && "min-h-0 flex-1 overflow-y-auto")}>
                    <MarkdownPreview content={value} />
                </div>
            ) : (
                <p className="m-0 px-4 py-6 text-center text-label text-muted-foreground">{empty}</p>
            )}
        </div>
    )
}
