import {useT} from "@agenta/i18n"
import galleryCatalog from "@agenta/i18n/catalogs/onboarding.gallery"
import {SkeletonBlock} from "@agenta/ui/ui"

/** The template rows while the catalog loads. */
export const OnboardingGallerySkeleton = () => {
    const t = useT(galleryCatalog)
    return (
        <div
            role="status"
            aria-label={t("onboarding.gallery.loading")}
            className="flex flex-col gap-1"
        >
            {Array.from({length: 6}, (_, index) => (
                <SkeletonBlock key={index} className="h-14 rounded-[10px]" />
            ))}
        </div>
    )
}
