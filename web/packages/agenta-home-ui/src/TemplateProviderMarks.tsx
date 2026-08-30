import {PROVIDERS} from "@agenta/entities/workflow"
import {LogoMarks} from "@agenta/ui/components/presentational"

/**
 * Brand-logo marks for a template's integrations (Composio's logo CDN).
 *
 * Resolution only: the run of logos itself is {@link LogoMarks} in `@agenta/ui`, shared with the
 * agent config drawers so a template card and a subagent row draw their integrations identically.
 */
export const TemplateProviderMarks = ({providers}: {providers: string[]}) => (
    <LogoMarks
        items={providers.flatMap((slug) => {
            const provider = PROVIDERS[slug]
            return provider ? [{key: slug, name: provider.label, logo: provider.logo}] : []
        })}
        size={16}
    />
)
