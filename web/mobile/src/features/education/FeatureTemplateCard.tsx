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
            className="box-border flex min-w-0 cursor-pointer flex-col disabled:cursor-wait disabled:opacity-60 rounded-xl border border-solid border-colorBorderSecondary bg-background px-4 pb-0 pt-4 text-left transition-[border-color,box-shadow] hover:border-border hover:shadow-[0_2px_8px_-2px_color-mix(in_srgb,var(--ag-colorText)_12%,transparent)]"
        >
            <span className="flex h-[30px] items-center">
                {shown.map((slug, index) => {
                    const provider = PROVIDERS[slug]
                    return (
                        <span
                            key={slug}
                            title={provider?.label ?? slug}
                            className={cn(
                                // Brand logos are drawn for a light ground: keep the tile white.
                                "box-border inline-flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border border-solid border-colorBorderSecondary bg-colorWhite",
                                index > 0 && "-ml-1.5",
                            )}
                        >
                            {provider ? (
                                <img
                                    src={provider.logo}
                                    alt={provider.label}
                                    className="size-[15px]"
                                />
                            ) : (
                                <span className="text-xs font-medium text-black">
                                    {slug.slice(0, 1).toUpperCase()}
                                </span>
                            )}
                        </span>
                    )
                })}
                {more > 0 ? (
                    <span className="ml-1.5 text-[13px] text-muted-foreground">+{more}</span>
                ) : null}
            </span>
            <span className="mt-3.5 text-[15px] font-medium text-foreground">{template.name}</span>
            <span className="mt-1.5 line-clamp-2 min-h-10 text-[13.5px] leading-[1.5] text-muted-foreground">
                {template.description}
            </span>
            <span className="mt-3 flex h-10 items-center justify-between gap-3 border-0 border-t border-solid border-colorBorderSecondary text-[12.5px] text-colorTextTertiary">
                <span className="flex min-w-0 items-center gap-1.5">
                    <TriggerIcon
                        weight="fill"
                        className="size-[13px] shrink-0 text-colorTextQuaternary"
                        aria-hidden
                    />
                    <span className="truncate">{template.trigger}</span>
                </span>
                <span className="shrink-0">{template.category}</span>
            </span>
        </button>
    )
}
