import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {LightningIcon} from "@phosphor-icons/react"

import {AppTileStack} from "./AppTileStack"
import {templateProviders} from "./marketplaceView"

/** What a template's card holds; the list frame draws the tile around it. */
export const TemplateCardBody = ({template}: {template: AgentStarterTemplate}) => (
    <>
        <AppTileStack apps={templateProviders(template)} size="md" className="mb-1" />
        <span className="truncate text-[14px] font-medium text-foreground" title={template.name}>
            {template.name}
        </span>
        <span className="text-muted-foreground line-clamp-2 min-h-10 text-[12.5px] leading-5">
            {template.description}
        </span>
        <span className="text-placeholder mt-auto flex min-w-0 items-center gap-2 border-x-0 border-b-0 border-t border-solid border-border pt-2.5 text-[11.5px]">
            <LightningIcon weight="fill" aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{template.trigger}</span>
            <span className="ml-auto shrink-0">{template.category}</span>
        </span>
    </>
)
