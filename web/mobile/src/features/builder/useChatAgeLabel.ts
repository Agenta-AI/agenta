import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

import {chatAge} from "./openRule"

/** "3d": the age of a chat by its last activity. */
export const useChatAgeLabel = () => {
    const t = useT(builderPanelCatalog)
    return (updatedAt: string | null | undefined, now: number) => {
        const age = chatAge(updatedAt, now)
        if (!age) return ""
        const value = String(age.count)
        if (age.unit === "minute") return t("builder.panel.ageMinutes", {value})
        if (age.unit === "hour") return t("builder.panel.ageHours", {value})
        return t("builder.panel.ageDays", {value})
    }
}
