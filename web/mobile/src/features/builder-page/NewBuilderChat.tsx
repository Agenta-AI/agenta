import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import dynamic from "next/dynamic"

import type {HeroState} from "./hero/BuilderHero"

// The hero's shader loads on its own, after the page is on screen.
const BuilderHero = dynamic(() => import("./hero/BuilderHero").then((m) => m.BuilderHero), {
    ssr: false,
    loading: () => <div className="size-45" />,
})

/** The top of a new chat on the builder page (B01): the hero, the question and what it does. */
export const NewBuilderChat = ({heroState}: {heroState: HeroState}) => {
    const t = useT(builderPageCatalog)
    return (
        <div className="flex flex-col items-center text-center" data-testid="builder-page-new-chat">
            {/* The canvas hero box is 236 px high (B01): the title sits under it. */}
            <div className="flex h-59 items-center justify-center">
                <BuilderHero state={heroState} className="size-45" />
            </div>
            <h1 className="m-0 mt-1.5 text-display text-foreground">
                {t("builder.page.heroTitle")}
            </h1>
            <p className="m-0 mt-1 max-w-105 text-body text-muted-foreground">
                {t("builder.page.heroLine")}
            </p>
        </div>
    )
}
