import {FileTextIcon} from "@phosphor-icons/react"

import {AssistantMarkdown} from "../chat/AssistantMarkdown"

import {SectionLabel} from "./SectionLabel"

/** The template's AGENTS.md, rendered as markdown under a file header. */
export const TemplateInstructions = ({markdown}: {markdown: string}) => (
    <div className="flex flex-col gap-2">
        <SectionLabel>Instructions</SectionLabel>
        <div className="box-border overflow-hidden rounded-lg border border-solid border-border bg-card">
            <div className="text-muted-foreground flex h-9 items-center gap-2 border-x-0 border-b border-t-0 border-solid border-border bg-colorFillQuaternary px-3.5 font-mono text-xs">
                <FileTextIcon aria-hidden className="size-3.5" />
                AGENTS.md
            </div>
            <div className="max-h-[420px] overflow-auto px-4 py-3">
                <AssistantMarkdown streaming={false} text={markdown} />
            </div>
        </div>
    </div>
)
