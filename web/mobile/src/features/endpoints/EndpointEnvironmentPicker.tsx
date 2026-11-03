import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {Segmented} from "@agenta/ui/ui"

/** One button per environment; an environment with nothing deployed cannot be picked. */
export const EndpointEnvironmentPicker = ({
    environments,
    selected,
    onSelect,
}: {
    environments: readonly AppEnvironmentDeployment[]
    selected: string | null
    onSelect: (slug: string) => void
}) => (
    <div className="flex flex-wrap items-center gap-2" data-testid="endpoints-environments">
        <span className="text-[13px] text-foreground">Environment: </span>
        <Segmented
            size="sm"
            value={selected ?? undefined}
            options={environments.map((env) => ({
                value: env.slug,
                label: env.name,
                disabled: !env.deployedVariantId,
            }))}
            onChange={(value) => onSelect(String(value))}
        />
    </div>
)
