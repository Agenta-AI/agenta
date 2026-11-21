import {createElement} from "react"

import {createT, type CatalogKey} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import type {SidebarConfig} from "@agenta/navigation"
import {ChartLineUpIcon} from "@phosphor-icons/react"

export const tNow = createT(navigationCatalog)

/** The nav labels' translator: callers inside React pass their own `t`, so a memo follows the language. */
export type NavTranslate = (key: CatalogKey<typeof navigationCatalog>) => string

/** The Observability rail row, in developer mode only (the old app hides it from the simple nav). */
export const observabilityNavItems = (
    projectURL: string,
    developerMode: boolean,
    t: NavTranslate = tNow,
): SidebarConfig[] =>
    developerMode
        ? [
              {
                  key: "mobile-observability",
                  title: t("navigation.items.observability"),
                  icon: createElement(ChartLineUpIcon, {size: 16}),
                  link: `${projectURL}/observability`,
                  prefetch: false,
              },
          ]
        : []
