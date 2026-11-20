import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import dynamic from "next/dynamic"

import type {HeroState} from "./hero/BuilderHero"

// The hero's shader loads on its own, after the page is on screen.
const BuilderHero = dynamic(() => import("./hero/BuilderHero").then((m) => m.BuilderHero), {
    ssr: false,
    loading: () => <div className="size-[180px]" />,
})

/** The top of a new chat on the builder page (B01): the hero, "Builder" and what it does. */
export const NewBuilderChat = ({heroState}: {heroState: HeroState}) => {
    const t = useT(builderPageCatalog)
    return (
        <div className="flex flex-col items-center text-center" data-testid="builder-page-new-chat">
            <BuilderHero state={heroState} className="size-[180px]" />
            <h1 className="m-0 mt-2 text-[28px] font-semibold tracking-tight text-colorText">
                {t("builder.page.builder")}
            </h1>
            <p className="m-0 mt-2 max-w-[440px] text-sm text-colorTextSecondary">
                {t("builder.page.heroLine")}
            </p>
        </div>
    )
}
