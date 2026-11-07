import {useT} from "@agenta/i18n/publish"
import {Switch, Textarea} from "@agenta/ui/ui"

export interface EmbedDomains {
    restricted: boolean
    origins: string
}

/** The "Specific domains" switch and list; with the switch off, any site may embed the agent. */
export const EmbedDomainsField = ({
    id,
    value,
    error,
    onChange,
}: {
    id: string
    value: EmbedDomains
    /** A refused list, shown under the text area. */
    error: string | null
    onChange: (patch: Partial<EmbedDomains>) => void
}) => {
    const t = useT()
    return (
        <div className="flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                <Switch
                    size="sm"
                    checked={value.restricted}
                    onCheckedChange={(restricted) => onChange({restricted})}
                    data-testid="agent-embed-restricted"
                />
                {t("publish.restrictDomainsToggle")}
            </label>
            {value.restricted ? (
                <>
                    <Textarea
                        id={id}
                        aria-label={t("publish.specificDomains")}
                        aria-invalid={error ? true : undefined}
                        rows={3}
                        placeholder={"https://example.com\nhttps://*.example.com"}
                        value={value.origins}
                        onChange={(e) => onChange({origins: e.target.value})}
                        data-testid="agent-embed-origins"
                    />
                    {error ? (
                        <span
                            role="alert"
                            className="text-[12.5px] text-destructive"
                            data-testid="agent-embed-origins-error"
                        >
                            {error}
                        </span>
                    ) : (
                        <span className="text-[12.5px] text-muted-foreground">
                            {t("publish.domainsHint")}
                        </span>
                    )}
                </>
            ) : null}
        </div>
    )
}
