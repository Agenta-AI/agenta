import {createElement} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {ChartLineUpIcon} from "@phosphor-icons/react"

/**
 * The Observability rail row: project traces and sessions. Shown in developer mode only, like the
 * old app, which hides it from the simplified navigation. The link does not prefetch, so the
 * traces screen does not load on the pages every user opens.
 */
export const observabilityNavItems = (
    projectURL: string,
    developerMode: boolean,
): SidebarConfig[] =>
    developerMode
        ? [
              {
                  key: "mobile-observability",
                  title: "Observability",
                  icon: createElement(ChartLineUpIcon, {size: 16}),
                  link: `${projectURL}/observability`,
                  prefetch: false,
              },
          ]
        : []
