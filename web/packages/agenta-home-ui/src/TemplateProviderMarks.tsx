import {PROVIDERS} from "@agenta/entities/workflow"
import {SimpleTooltip} from "@agenta/ui/ui"

/**
 * Brand-logo marks for a template's integrations (Composio's logo CDN).
 *
 * A plain `<img>`, not `next/image`: the sources are remote, and every app that renders a template
 * card would otherwise need the CDN host in its own `images` config.
 */
export const TemplateProviderMarks = ({providers}: {providers: string[]}) => {
    if (!providers.length) return null
    return (
        <div className="flex items-center gap-1.5">
            {providers.map((slug) => {
                const provider = PROVIDERS[slug]
                if (!provider) return null
                return (
                    <SimpleTooltip key={slug} title={provider.label}>
                        <span className="inline-flex">
                            <img
                                src={provider.logo}
                                alt={provider.label}
                                width={16}
                                height={16}
                                className="shrink-0 rounded object-contain"
                            />
                        </span>
                    </SimpleTooltip>
                )
            })}
        </div>
    )
}
