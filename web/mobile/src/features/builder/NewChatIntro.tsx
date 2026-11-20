import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import dynamic from "next/dynamic"

// The hero's shader loads on its own, after the chat is on screen.
const BuilderHero = dynamic(
    () => import("../builder-page/hero/BuilderHero").then((m) => m.BuilderHero),
    {ssr: false, loading: () => <div className="size-40" />},
)

/** The top of a new builder chat: the hero, "What should we change?" and what the builder can do. */
export const NewChatIntro = ({agentName}: {agentName: string}) => {
    const t = useT(builderPanelCatalog)
    return (
        <div className="flex flex-col items-center text-center" data-testid="builder-new-chat">
            <BuilderHero state="idle" className="size-40" />
            <h2 className="m-0 mt-1 text-2xl font-semibold tracking-tight text-colorText">
                {t("builder.panel.question")}
            </h2>
            <p className="m-0 mt-1 text-sm text-colorTextSecondary">
                {t("builder.panel.intro", {agent: agentName})}
            </p>
        </div>
    )
}
