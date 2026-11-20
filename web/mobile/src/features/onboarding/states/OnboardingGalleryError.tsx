import {useT} from "@agenta/i18n"
import galleryCatalog from "@agenta/i18n/catalogs/onboarding.gallery"
import {LoadError} from "@agenta/ui/components/presentational"

/** A failed catalog read; New agent stays above it, so the flow never dead-ends. */
export const OnboardingGalleryError = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(galleryCatalog)
    return <LoadError title={t("onboarding.gallery.loadError")} onRetry={onRetry} />
}
