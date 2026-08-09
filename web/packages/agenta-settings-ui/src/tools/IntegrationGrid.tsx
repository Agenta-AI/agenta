import {useState, useMemo} from "react"

import type {ToolCatalogIntegration} from "@agenta/entities/gatewayTool"
import {EmptyState, Input, Spinner} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"

import {useToolsIntegrations} from "./hooks/useToolsIntegrations"

interface Props {
    onSelect: (integrationKey: string) => void
}

export default function IntegrationGrid({onSelect}: Props) {
    const {integrations, isLoading} = useToolsIntegrations()
    const [search, setSearch] = useState("")

    const filtered = useMemo(() => {
        if (!search.trim()) return integrations
        const q = search.toLowerCase()
        return integrations.filter(
            (i) =>
                i.name.toLowerCase().includes(q) ||
                i.description?.toLowerCase().includes(q) ||
                (i.categories ?? []).some((c) => c.toLowerCase().includes(q)),
        )
    }, [integrations, search])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner />
            </div>
        )
    }

    return (
        <section className="flex flex-col gap-4">
            <div className="relative max-w-[320px]">
                <MagnifyingGlass
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-colorTextTertiary"
                />
                <Input
                    placeholder="Search integrations…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                />
            </div>

            {filtered.length === 0 ? (
                <EmptyState image="simple" description="No integrations found" />
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((integration) => (
                        <IntegrationCard
                            key={integration.key}
                            integration={integration}
                            onClick={() => onSelect(integration.key)}
                        />
                    ))}
                </div>
            )}
        </section>
    )
}

function IntegrationCard({
    integration,
    onClick,
}: {
    integration: ToolCatalogIntegration
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="cursor-pointer rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3 text-left hover:border-colorPrimary"
        >
            <div className="flex items-start gap-3">
                {/* Catalog logos are remote and arbitrary; next/image would need every host
                    allow-listed, and a package cannot own that config. */}
                {integration.logo && (
                    <img
                        src={integration.logo}
                        alt={integration.name}
                        className="size-8 shrink-0 rounded object-contain"
                    />
                )}
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-xs font-medium text-colorText">
                        {integration.name}
                    </span>
                    {integration.description && (
                        <span className="line-clamp-2 text-xs text-colorTextSecondary">
                            {integration.description}
                        </span>
                    )}
                </div>
            </div>
        </button>
    )
}
