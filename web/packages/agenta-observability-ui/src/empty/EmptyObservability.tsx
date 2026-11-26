import {memo, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import emptyCatalog from "@agenta/i18n/catalogs/observabilityUi.empty"
import {EmptyPlaceholder, EmptyState} from "@agenta/ui/components/presentational"
import {ProhibitIcon, TreeStructureIcon} from "@phosphor-icons/react"

export interface EmptyObservabilityProps {
    showOnboarding?: boolean
    rateLimited?: boolean
    rateLimitMessage?: string
    /** Cloudflare Stream id for the onboarding video. Host-supplied. */
    videoId?: string
    /** Fires the host's onboarding widget (OSS: the `tracing-snippet` step). */
    onSetupTracing?: () => void
    /** Rendered after the rate-limit copy — OSS passes its billing `<Link>`. */
    upgradeAction?: ReactNode
}

export const EmptyObservability = memo(
    ({
        showOnboarding = true,
        rateLimited = false,
        rateLimitMessage,
        videoId,
        onSetupTracing,
        upgradeAction,
    }: EmptyObservabilityProps) => {
        const t = useT(emptyCatalog)
        if (rateLimited) {
            return (
                <div className="py-16">
                    <EmptyPlaceholder
                        image={<ProhibitIcon size={32} />}
                        description={
                            <div className="flex flex-col gap-2">
                                <span className="text-lg font-medium text-colorText">
                                    {t("observabilityUi.empty.rateLimitReached")}
                                </span>
                                <span className="text-colorTextSecondary">
                                    {rateLimitMessage || t("observabilityUi.empty.quotaReached")}
                                    {upgradeAction ? <> {upgradeAction}</> : null}
                                </span>
                            </div>
                        }
                    />
                </div>
            )
        }

        if (!showOnboarding) {
            return (
                <div className="py-16">
                    <EmptyPlaceholder
                        image={<TreeStructureIcon size={32} className="text-colorTextQuaternary" />}
                        description={
                            <div className="flex flex-col gap-2">
                                <span className="text-lg font-medium text-colorText">
                                    {t("observabilityUi.empty.noTracesFound")}
                                </span>
                                <span className="text-colorTextSecondary">
                                    {t("observabilityUi.empty.adjustTraces")}
                                </span>
                            </div>
                        }
                    />
                </div>
            )
        }

        return (
            <EmptyState
                className="py-4"
                videoId={videoId}
                previewAlt={t("observabilityUi.empty.demoAlt")}
                title={t("observabilityUi.empty.noTracesYet")}
                description={t("observabilityUi.empty.onboardingDescription")}
                primaryCta={{
                    label: t("observabilityUi.empty.setUpTracing"),
                    onClick: onSetupTracing,
                }}
                secondaryCta={{
                    label: t("observabilityUi.empty.learnMore"),
                    href: "https://docs.agenta.ai/observability/quickstart",
                }}
            />
        )
    },
)

export default EmptyObservability
