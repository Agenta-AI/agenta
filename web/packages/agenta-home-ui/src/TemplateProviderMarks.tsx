import {PROVIDERS} from "@agenta/entities/workflow"
import {LogoMarks} from "@agenta/ui/components/presentational"

/** Brand-logo marks for a template's integrations. Resolution only: the run is {@link LogoMarks}. */
export const TemplateProviderMarks = ({
    providers,
    size = 16,
    stacked,
}: {
    providers: string[]
    /** 16 is the template card's; a dense two-line row wants less weight at its end. */
    size?: number
    /** Overlap the run — for a row end, where a spaced run costs too much width. */
    stacked?: boolean
}) => (
    <LogoMarks
        items={providers.flatMap((slug) => {
            const provider = PROVIDERS[slug]
            return provider ? [{key: slug, name: provider.label, logo: provider.logo}] : []
        })}
        size={size}
        stacked={stacked}
    />
)
