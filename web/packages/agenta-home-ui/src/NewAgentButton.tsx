import {EnhancedButton} from "@agenta/ui/components/presentational"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ArrowRightIcon, PlusIcon} from "@phosphor-icons/react"
import Link from "next/link"

export interface NewAgentTemplate {
    key: string
    name: string
    description?: string
    /** Avatar tile — two letters over the template's own colour. */
    initials: string
    color: string
}

export interface NewAgentButtonProps {
    /** Blank create. The only entry every surface has. */
    onCreateBlank: () => void
    /**
     * Template seeds. Omit (or pass none) and the templates section disappears with them — a
     * surface that cannot seed a template must not offer one.
     */
    templates?: NewAgentTemplate[]
    onPickTemplate?: (templateKey: string) => void
    /** The full gallery. Omit and the footer link goes with it. */
    browseHref?: string
    /** Total template count for the footer link; defaults to what was passed. */
    totalTemplates?: number
    label?: string
    /** A create is in flight — the trigger reports it rather than accepting a second click. */
    loading?: boolean
}

/** Enough to recognise the shape of what's on offer; the rest is one click away. */
const SUGGESTED = 4

/**
 * The one way to create an agent: blank, or from a template.
 *
 * Both land on the same create surface, so a template pick is a seed rather than a separate
 * flow — the alternative was a plain button that hid templates behind a rail section and a
 * gallery nobody could reach.
 */
export const NewAgentButton = ({
    onCreateBlank,
    templates = [],
    onPickTemplate,
    browseHref,
    totalTemplates,
    label = "New agent",
    loading = false,
}: NewAgentButtonProps) => {
    const suggested = onPickTemplate ? templates.slice(0, SUGGESTED) : []

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={loading}>
                <EnhancedButton type="primary" loading={loading} icon={<PlusIcon size={14} />}>
                    {label}
                </EnhancedButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[320px]">
                <DropdownMenuItem onSelect={onCreateBlank}>
                    <PlusIcon size={16} />
                    <span className="flex flex-col py-0.5">
                        <span className="text-sm text-colorText">Blank agent</span>
                        <span className="text-xs text-colorTextTertiary">
                            Configure model, instructions and tools yourself
                        </span>
                    </span>
                </DropdownMenuItem>

                {suggested.length > 0 ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Templates</DropdownMenuLabel>
                        {suggested.map((template) => (
                            <DropdownMenuItem
                                key={template.key}
                                onSelect={() => onPickTemplate?.(template.key)}
                            >
                                <span
                                    aria-hidden
                                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                                    style={{background: template.color}}
                                >
                                    {template.initials}
                                </span>
                                <span className="flex min-w-0 flex-col py-0.5">
                                    <span className="truncate text-sm text-colorText">
                                        {template.name}
                                    </span>
                                    <span className="truncate text-xs text-colorTextTertiary">
                                        {template.description}
                                    </span>
                                </span>
                            </DropdownMenuItem>
                        ))}
                    </>
                ) : null}

                {browseHref ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link
                                href={browseHref}
                                className="inline-flex items-center gap-1 !text-colorPrimary"
                            >
                                Browse all {totalTemplates ?? templates.length} templates
                                <ArrowRightIcon size={12} />
                            </Link>
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
