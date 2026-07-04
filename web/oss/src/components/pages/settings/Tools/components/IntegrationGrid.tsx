import {useState, useMemo} from "react"

import type {ToolCatalogIntegration} from "@agenta/entities/gatewayTool"
import {Card, CardContent} from "@agenta/primitive-ui/components/card"
import {Empty, EmptyDescription, EmptyHeader} from "@agenta/primitive-ui/components/empty"
import {Input} from "@agenta/primitive-ui/components/input"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {MagnifyingGlass} from "@phosphor-icons/react"
import Image from "next/image"

import {useToolsIntegrations} from "../hooks/useToolsIntegrations"

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
                    className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    placeholder="Search integrations…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="ps-8"
                />
            </div>

            {filtered.length === 0 ? (
                <Empty>
                    <EmptyHeader>
                        <EmptyDescription>No integrations found</EmptyDescription>
                    </EmptyHeader>
                </Empty>
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
        <Card onClick={onClick} className="cursor-pointer py-3 transition-colors hover:border-ring">
            <CardContent className="px-3">
                <div className="flex items-start gap-3">
                    {integration.logo && (
                        <Image
                            src={integration.logo}
                            alt={integration.name}
                            width={32}
                            height={32}
                            className="w-8 h-8 rounded object-contain shrink-0"
                            unoptimized
                        />
                    )}
                    <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="truncate font-semibold">{integration.name}</span>
                        </div>
                        {integration.description && (
                            <span className="text-xs text-muted-foreground line-clamp-2">
                                {integration.description}
                            </span>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
