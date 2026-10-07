import {cn} from "@/lib/utils"

import {AppTile} from "./AppTile"
import type {TemplateToolRow} from "./marketplaceView"

/** The tools a template's agent can call, each under the app it belongs to. */
export const TemplateToolList = ({
    tools,
    columns = 1,
}: {
    tools: TemplateToolRow[]
    /** 2 on the full page, where the section has the width for a grid. */
    columns?: 1 | 2
}) => (
    <ul
        className={cn(
            "m-0 grid list-none gap-2 p-0",
            columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1",
        )}
    >
        {tools.map((tool) => (
            <li
                key={`${tool.app.slug}-${tool.name}`}
                className="box-border flex gap-3 rounded-lg border border-solid border-border bg-card p-3"
            >
                <AppTile app={tool.app} size="sm" />
                <span className="flex min-w-0 flex-col gap-0.5">
                    <code className="font-mono text-xs text-foreground">{tool.name}</code>
                    <span className="text-muted-foreground text-xs leading-5">
                        {tool.description}
                    </span>
                </span>
            </li>
        ))}
    </ul>
)
