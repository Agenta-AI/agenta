import {SimpleTooltip, Switch, Textarea} from "@agenta/ui/ui"
import {Info} from "@phosphor-icons/react"

export interface EmbedDomains {
    restricted: boolean
    origins: string
}

/** The "Specific domains" toggle and list; with the toggle off, any site may embed the agent. */
export const EmbedDomainsField = ({
    id,
    value,
    onChange,
}: {
    id: string
    value: EmbedDomains
    onChange: (patch: Partial<EmbedDomains>) => void
}) => (
    <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-foreground">Specific domains</span>
            <SimpleTooltip title="When this is off, anyone can embed the agent on any site.">
                <button
                    type="button"
                    aria-label="About specific domains"
                    className="inline-flex border-0 bg-transparent p-0 text-muted-foreground"
                >
                    <Info size={14} />
                </button>
            </SimpleTooltip>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
            <Switch
                size="sm"
                checked={value.restricted}
                onCheckedChange={(restricted) => onChange({restricted})}
                data-testid="agent-embed-restricted"
            />
            Only allow embedding the agent on specific domains
        </label>
        {value.restricted ? (
            <>
                <Textarea
                    id={id}
                    aria-label="Specific domains"
                    rows={3}
                    placeholder={"https://example.com\nhttps://*.example.com"}
                    value={value.origins}
                    onChange={(e) => onChange({origins: e.target.value})}
                    data-testid="agent-embed-origins"
                />
                <span className="text-[12.5px] text-muted-foreground">
                    Enter each domain in a new line
                </span>
            </>
        ) : null}
    </div>
)
