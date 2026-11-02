import {templateBuilderMessage, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {LoadingButton} from "@agenta/ui/ui"

import {TemplateConnectList} from "./TemplateConnectList"
import {TemplateUseCardGroup} from "./TemplateUseCardGroup"

/** The template page's decision card: use it, what it connects, and how it starts. */
export const TemplateUseCard = ({
    template,
    busy,
    onUse,
}: {
    template: AgentStarterTemplate
    busy: boolean
    onUse: () => void
}) => {
    return (
        <aside className="box-border overflow-hidden rounded-lg border border-solid border-border bg-card">
            {/* Below lg the screen pins its own Use button. */}
            <div className="hidden border-x-0 border-b border-t-0 border-solid border-border lg:block">
                <TemplateUseCardGroup>
                    <LoadingButton loading={busy} onClick={onUse} className="w-full">
                        Use this template
                    </LoadingButton>
                    <span className="text-muted-foreground text-center text-xs">
                        Next, connect its apps. Then Agenta creates the agent.
                    </span>
                </TemplateUseCardGroup>
            </div>
            {template.connections.length ? (
                <TemplateUseCardGroup label="Connects">
                    <TemplateConnectList template={template} />
                </TemplateUseCardGroup>
            ) : null}
            <TemplateUseCardGroup label="Starts with">
                <p className="m-0 rounded-md bg-colorFillQuaternary px-3 py-2 text-[13px] leading-5 text-foreground">
                    {templateBuilderMessage(template)}
                </p>
            </TemplateUseCardGroup>
        </aside>
    )
}
