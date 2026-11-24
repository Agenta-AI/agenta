import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {IconTile} from "@agenta/ui/ui"

/**
 * The top of a new builder chat: a 40 px neutral Mark, the question and what the builder can do.
 * No decorative illustration in the right pane (LOUD-01/02); the title is a text style (TYPE-01).
 */
export const NewChatIntro = ({agentName}: {agentName: string; phone?: boolean}) => {
    const t = useT(builderPanelCatalog)
    return (
        <div className="flex flex-col items-center text-center" data-testid="builder-new-chat">
            <IconTile size={40} tone="neutral" aria-hidden>
                <BuilderIcon />
            </IconTile>
            <h2 className="m-0 mt-3 text-title text-foreground">
                {t("builder.panel.question", {agent: agentName})}
            </h2>
            <p className="m-0 mt-1 max-w-[320px] text-body-sm text-muted-foreground">
                {t("builder.panel.intro")}
            </p>
        </div>
    )
}
