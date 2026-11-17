import {templateBuilderMessage, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import marketplaceCatalog from "@agenta/i18n/catalogs/marketplace.page"
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
    const t = useT(marketplaceCatalog)
    return (
        <aside className="box-border overflow-hidden rounded-lg border border-solid border-border bg-card">
            {/* Below lg the screen pins its own Use button. */}
            <div className="hidden border-x-0 border-b border-t-0 border-solid border-border lg:block">
                <TemplateUseCardGroup>
                    <LoadingButton loading={busy} onClick={onUse} className="w-full">
                        {t("marketplace.page.useTemplate")}
                    </LoadingButton>
                    <span className="text-muted-foreground text-center text-xs">
                        {t("marketplace.page.createsAgentNote")}
                    </span>
                </TemplateUseCardGroup>
            </div>
            {template.connections.length ? (
                <TemplateUseCardGroup label={t("marketplace.page.connects")}>
                    <TemplateConnectList template={template} />
                </TemplateUseCardGroup>
            ) : null}
            <TemplateUseCardGroup label={t("marketplace.page.startsWith")}>
                <p className="m-0 rounded-md bg-colorFillQuaternary px-3 py-2 text-[13px] leading-5 text-foreground">
                    {templateBuilderMessage(template)}
                </p>
            </TemplateUseCardGroup>
        </aside>
    )
}
