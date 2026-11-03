import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {FormattedDate, Tag} from "@agenta/ui/components/presentational"
import {Badge} from "@agenta/ui/ui"
import Link from "next/link"

const CARD_CLASS =
    "flex min-w-0 flex-col gap-2 rounded-lg border border-solid bg-card p-3 text-left text-sm"

const CardBody = ({environment}: {environment: AppEnvironmentDeployment}) => (
    <>
        <Tag env={environment.name} />
        <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="text-muted-foreground">Variant</span>
            {environment.deployedVariantName ? (
                <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate">{environment.deployedVariantName}</span>
                    {environment.revision ? <Badge>v{environment.revision}</Badge> : null}
                </span>
            ) : (
                <Tag label="No deployment" />
            )}
        </span>
        <span className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Last modified</span>
            <FormattedDate date={environment.updatedAt} />
        </span>
    </>
)

/**
 * One card per environment of the app. With `onSelect` a card chooses that environment's history.
 * With `getHref` a card is a link instead. With neither it is a plain block.
 */
export const EnvironmentCards = ({
    environments,
    selectedSlug = null,
    onSelect,
    getHref,
}: {
    environments: readonly AppEnvironmentDeployment[]
    selectedSlug?: string | null
    onSelect?: (slug: string) => void
    getHref?: (environment: AppEnvironmentDeployment) => string
}) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {environments.map((environment) => {
            const key = environment.slug || environment.name
            const body = <CardBody environment={environment} />
            if (getHref) {
                return (
                    <Link
                        key={key}
                        href={getHref(environment)}
                        prefetch={false}
                        className={`${CARD_CLASS} border-border text-foreground no-underline`}
                    >
                        {body}
                    </Link>
                )
            }
            if (!onSelect) {
                return (
                    <div key={key} className={`${CARD_CLASS} border-border`}>
                        {body}
                    </div>
                )
            }
            const selected = environment.slug === selectedSlug
            return (
                <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(environment.slug)}
                    className={`${CARD_CLASS} ${selected ? "border-2 border-foreground" : "border-border"}`}
                >
                    {body}
                </button>
            )
        })}
    </div>
)
