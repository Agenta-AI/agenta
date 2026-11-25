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
            {/* The ribbon fills the middle of its square, so the box takes the canvas orb's
                height (125 px in the panel, S07; 104 px on a phone, M04) and the rest overhangs. */}
            <div
                className={cn(
                    "flex items-center justify-center",
                    phone ? "h-[104px]" : "h-[125px]",
                )}
            >
                <BuilderHero state="idle" className="size-40" />
            </div>
            <h2
                className={cn(
                    "m-0 font-semibold tracking-tight text-colorText",
                    phone && "mt-1.5",
                    phone ? "text-[22px] leading-7" : "text-xl leading-[26px]",
                )}
            >
                {t("builder.panel.question", {agent: agentName})}
            </h2>
            <p
                className={cn(
                    "m-0 mt-1 max-w-[320px] text-colorTextSecondary",
                    phone ? "text-sm" : "text-[13px] leading-5",
                )}
            >
                {t("builder.panel.intro")}
            </p>
        </div>
    )
}
