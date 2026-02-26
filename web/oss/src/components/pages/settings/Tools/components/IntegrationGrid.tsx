import {useState, useMemo} from "react"

import {MagnifyingGlass} from "@phosphor-icons/react"
import {Card, Empty, Input, Spin, Typography} from "antd"
import Image from "next/image"

import type {IntegrationItem} from "@/oss/services/tools/api/types"

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
                i.categories.some((c) => c.toLowerCase().includes(q)),
        )
    }, [integrations, search])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spin />
            </div>
        )
    }

    return (
        <section className="flex flex-col gap-4">
            <Input
                placeholder="Search integrations…"
                prefix={<MagnifyingGlass size={16} />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-[320px]"
                allowClear
            />

            {filtered.length === 0 ? (
                <Empty description="No integrations found" />
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
    integration: IntegrationItem
    onClick: () => void
}) {
    return (
        <Card hoverable onClick={onClick} className="cursor-pointer" size="small">
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
                        <Typography.Text strong className="truncate">
                            {integration.name}
                        </Typography.Text>
                    </div>
                    {integration.description && (
                        <Typography.Text type="secondary" className="text-xs line-clamp-2">
                            {integration.description}
                        </Typography.Text>
                    )}
                </div>
            </div>
        </Card>
    )
}
