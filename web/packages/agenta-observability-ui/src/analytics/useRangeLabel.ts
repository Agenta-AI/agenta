import {useT} from "@agenta/i18n"
import analyticsCatalog from "@agenta/i18n/catalogs/observabilityUi.analytics"
import {
    analyticsCustomRangeAtom,
    analyticsRangeAtom,
    analyticsRangeLabelAtom,
} from "@agenta/observability/analytics"
import {useAtomValue} from "jotai"

/**
 * The open range as the reader's words, and the same words ready to sit inside a sentence. A
 * custom range keeps the dates the shared state formats.
 */
export const useRangeLabel = () => {
    const t = useT(analyticsCatalog)
    const range = useAtomValue(analyticsRangeAtom)
    const custom = useAtomValue(analyticsCustomRangeAtom)
    const customLabel = useAtomValue(analyticsRangeLabelAtom)
    if (custom) return {label: customLabel, inline: customLabel.toLowerCase()}
    switch (range) {
        case "24h":
            return {
                label: t("observabilityUi.analytics.rangeLast24h"),
                inline: t("observabilityUi.analytics.rangeInline24h"),
            }
        case "7d":
            return {
                label: t("observabilityUi.analytics.rangeLast7d"),
                inline: t("observabilityUi.analytics.rangeInline7d"),
            }
        case "30d":
            return {
                label: t("observabilityUi.analytics.rangeLast30d"),
                inline: t("observabilityUi.analytics.rangeInline30d"),
            }
        default:
            return {
                label: t("observabilityUi.analytics.rangeLast90d"),
                inline: t("observabilityUi.analytics.rangeInline90d"),
            }
    }
}
