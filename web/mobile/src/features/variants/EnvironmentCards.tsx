import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {FormattedDate, Tag} from "@agenta/ui/components/presentational"
import {Badge} from "@agenta/ui/ui"

/** One card per environment of the app. Choosing a card selects that environment's history. */
export const EnvironmentCards = ({
    environments,
    selectedSlug,
    onSelect,
}: {
    environments: readonly AppEnvironmentDeployment[]
    selectedSlug: string | null
    onSelect: (slug: string) => void
}) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {environments.map((environment) => {
            const selected = environment.slug === selectedSlug
            return (
                <button
                    key={environment.slug || environment.name}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(environment.slug)}
                    className={`flex min-w-0 flex-col gap-2 rounded-lg border border-solid bg-card p-3 text-left text-sm ${
                        selected ? "border-2 border-foreground" : "border-border"
                    }`}
                >
                    <Tag env={environment.name} />
                    <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="text-muted-foreground">Variant</span>
                        {environment.deployedVariantName ? (
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="truncate">{environment.deployedVariantName}</span>
                                {environment.revision ? (
                                    <Badge>v{environment.revision}</Badge>
                                ) : null}
                            </span>
                        ) : (
                            <Tag label="No deployment" />
                        )}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Last modified</span>
                        <FormattedDate date={environment.updatedAt} />
                    </span>
                </button>
            )
        })}
    </div>
)
