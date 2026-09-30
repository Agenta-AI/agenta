import {
    templateBuilderMessage,
    type AgentStarterTemplate,
    type AgentTemplateProvenance,
} from "@agenta/entities/workflow"
import {LoadingButton} from "@agenta/ui/ui"

import {cn} from "@/lib/utils"

import {triggerText} from "./marketplaceView"
import {TemplateConnectList} from "./TemplateConnectList"
import {TemplateUseCardGroup} from "./TemplateUseCardGroup"

/** The template page's decision card: use it, what it connects, and where it comes from. */
export const TemplateUseCard = ({
    template,
    provenance,
    busy,
    onUse,
}: {
    template: AgentStarterTemplate
    provenance?: AgentTemplateProvenance
    busy: boolean
    onUse: () => void
}) => {
    const facts = [
        {label: "Runs on", value: triggerText(template), mono: false},
        {label: "Model", value: template.model, mono: true},
        {label: "Version", value: provenance?.version, mono: true},
        {label: "Created by", value: provenance?.author.name, mono: false},
    ].filter((fact) => fact.value)

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
            <TemplateUseCardGroup>
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-xs">
                    {facts.map((fact) => (
                        <div key={fact.label} className="contents">
                            <dt className="text-muted-foreground">{fact.label}</dt>
                            <dd
                                className={cn(
                                    "m-0 text-right text-foreground",
                                    fact.mono && "font-mono",
                                )}
                            >
                                {fact.value}
                            </dd>
                        </div>
                    ))}
                </dl>
            </TemplateUseCardGroup>
        </aside>
    )
}
