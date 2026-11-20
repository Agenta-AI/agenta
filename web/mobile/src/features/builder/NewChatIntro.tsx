import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import dynamic from "next/dynamic"

import {cn} from "@/lib/utils"

// The hero's shader loads on its own, after the chat is on screen.
const BuilderHero = dynamic(
    () => import("../builder-page/hero/BuilderHero").then((m) => m.BuilderHero),
    {ssr: false, loading: () => <div className="size-40" />},
)

/** The top of a new builder chat: the hero, the question and what the builder can do. */
export const NewChatIntro = ({agentName, phone = false}: {agentName: string; phone?: boolean}) => {
    const t = useT(builderPanelCatalog)
    return (
        <div className="flex flex-col items-center text-center" data-testid="builder-new-chat">
            <BuilderHero state="idle" className="size-40" />
            <h2
                className={cn(
                    "m-0 mt-1 font-semibold tracking-tight text-colorText",
                    phone ? "text-[22px] leading-7" : "text-xl leading-[26px]",
                )}
            >
                {t("builder.panel.question")}
            </h2>
            <p
                className={cn(
                    "m-0 mt-1 max-w-[320px] text-colorTextSecondary",
                    phone ? "text-sm" : "text-[13px] leading-5",
                )}
            >
                {t("builder.panel.intro", {agent: agentName})}
            </p>
        </div>
    )
}
