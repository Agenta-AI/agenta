import {createElement} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {ChartLineUpIcon} from "@phosphor-icons/react"

/** The Observability rail row, in developer mode only (the old app hides it from the simple nav). */
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
