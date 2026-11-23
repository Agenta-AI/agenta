import {
    PROVIDERS,
    templateProviderSlugs,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {ChatCircle, Lightning} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

/** Three tiles fit the row; the rest collapse into "+N". */
const MAX_APPS = 3

/** One starter template: the apps it connects, what it does, and when it runs. */
export const FeatureTemplateCard = ({
    template,
    disabled = false,
    onSelect,
}: {
    template: AgentStarterTemplate
    disabled?: boolean
    onSelect: (template: AgentStarterTemplate) => void
}) => {
    const slugs = templateProviderSlugs(template)
    const shown = slugs.slice(0, MAX_APPS)
    const more = slugs.length - shown.length
    // A manual template runs when asked in chat, not on an event.
    const TriggerIcon = template.trigger === "Manual" ? ChatCircle : Lightning

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(template)}
            className="box-border flex min-w-0 cursor-pointer flex-col disabled:cursor-wait disabled:opacity-60 rounded-lg border border-solid border-border-muted bg-background px-4 pb-0 pt-4 text-left transition-colors hover:bg-[image:linear-gradient(var(--accent),var(--accent))] focus-ring"
        >
            <span className="flex h-8 items-center">
                {shown.map((slug, index) => {
                    const provider = PROVIDERS[slug]
                    return (
                        <span
                            key={slug}
                            title={provider?.label ?? slug}
                            className={cn(
                                // Brand logos are drawn for a light ground: keep the tile white.
                                "box-border inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-solid border-border-muted bg-white",
                                index > 0 && "-ml-1.5",
                            )}
                        >
                            {provider ? (
                                <img
                                    src={provider.logo}
                                    alt={provider.label}
                                    className="size-4"
                                />
                            ) : (
                                <span className="text-label text-black">
                                    {slug.slice(0, 1).toUpperCase()}
                                </span>
                            )}
                        </span>
                    )
                })}
                {more > 0 ? (
                    <span className="ml-1.5 text-label text-muted-foreground">+{more}</span>
                ) : null}
            </span>
            <span className="mt-3 text-title text-foreground">{template.name}</span>
            <span className="mt-1.5 line-clamp-2 min-h-11 text-body text-muted-foreground">
                {template.description}
            </span>
            <span className="mt-3 flex h-10 items-center justify-between gap-3 border-0 border-t border-solid border-border-muted text-label text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                    <TriggerIcon
                        weight="fill"
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                    />
                    <span className="truncate">{template.trigger}</span>
                </span>
                <span className="shrink-0">{template.category}</span>
            </span>
        </button>
    )
}
