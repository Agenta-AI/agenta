import type {AgentStarterTemplate} from "@agenta/entities/workflow"

import {AppTileStack} from "./AppTileStack"
import {templateConnects} from "./marketplaceView"

/** Each connection slot with every app that fills it ("GitHub or GitLab") and whether it is needed. */
export const TemplateConnectList = ({template}: {template: AgentStarterTemplate}) => (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {templateConnects(template).map((connect) => (
            <li key={connect.key} className="flex items-center gap-2.5 text-[13px]">
                <AppTileStack apps={connect.apps} size="sm" decorative />
                <span className="min-w-0 flex-1 truncate text-foreground">{connect.label}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                    {connect.required ? "Required" : "Optional"}
                </span>
            </li>
        ))}
    </ul>
)
