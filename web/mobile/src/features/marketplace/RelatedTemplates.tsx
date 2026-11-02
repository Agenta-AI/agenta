import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import Link from "next/link"

import {AppTileStack} from "./AppTileStack"
import {templateProviders} from "./marketplaceView"

/** More templates from the same category, each opening its own page. */
export const RelatedTemplates = ({
    category,
    templates,
    hrefOf,
    categoryHref,
}: {
    category: string
    templates: AgentStarterTemplate[]
    hrefOf: (template: AgentStarterTemplate) => string
    categoryHref: string
}) => (
    <section className="flex flex-col gap-3 border-x-0 border-b-0 border-t border-solid border-border pt-6">
        <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-sm font-semibold text-foreground">More in {category}</h2>
            <Link
                href={categoryHref}
                className="text-muted-foreground hover:text-foreground text-xs"
            >
                View all
            </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
                <Link
                    key={template.key}
                    href={hrefOf(template)}
                    className="box-border flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-border bg-card p-3 text-card-foreground transition-[border-color,box-shadow] hover:border-foreground/30 motion-reduce:transition-none"
                >
                    <AppTileStack apps={templateProviders(template)} size="sm" />
                    <span className="truncate text-[14px] font-medium text-foreground">
                        {template.name}
                    </span>
                    <span className="text-muted-foreground line-clamp-2 text-[12.5px] leading-5">
                        {template.description}
                    </span>
                </Link>
            ))}
        </div>
    </section>
)
