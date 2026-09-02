import {PROVIDERS} from "@agenta/entities/workflow"
import {LogoMarks} from "@agenta/ui/components/presentational"

/** Brand-logo marks for a template's integrations. Resolution only: the run is {@link LogoMarks}. */
export const TemplateProviderMarks = ({providers}: {providers: string[]}) => (
    <LogoMarks
        items={providers.flatMap((slug) => {
            const provider = PROVIDERS[slug]
            return provider ? [{key: slug, name: provider.label, logo: provider.logo}] : []
        })}
        size={16}
    />
)
