import {useState} from "react"

import {MarkdownEditor} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {MarkdownPreview} from "@agenta/ui"
import {cn} from "@agenta/ui/styles"
import {Segmented} from "@agenta/ui/ui"

type MarkdownView = "write" | "preview"

/** One bordered markdown box: the formatting tools and Write/Preview in its top bar, then the text. */
export function SkillMarkdownFrame({
    value,
    onChange,
    placeholder,
    empty,
    readOnly = false,
    invalid = false,
    defaultView = "preview",
}: {
    value: string
    onChange: (next: string) => void
    placeholder: string
    /** What Preview shows when there is no text. */
    empty: string
    readOnly?: boolean
    invalid?: boolean
    defaultView?: MarkdownView
}) {
    const t = useT(skillsEditorCatalog)
    const [view, setView] = useState<MarkdownView>(readOnly ? "preview" : defaultView)
    const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
    const writing = view === "write" && !readOnly

    return (
        <div
            className={cn(
                "md-doc flex min-w-0 flex-col rounded-lg border border-solid",
                invalid ? "border-destructive" : "border-border-muted",
            )}
        >
            {readOnly ? null : (
                <div className="flex min-h-10 items-center gap-2 border-0 border-b border-solid border-border-muted px-2">
                    <div ref={setToolbarHost} className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]" />
                    <Segmented
                        size="sm"
                        value={view}
                        onChange={(next) => setView(next as MarkdownView)}
                        options={[
                            {value: "write", label: t("skills.editor.write")},
                            {value: "preview", label: t("skills.editor.preview")},
                        ]}
                    />
                </div>
            )}
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
