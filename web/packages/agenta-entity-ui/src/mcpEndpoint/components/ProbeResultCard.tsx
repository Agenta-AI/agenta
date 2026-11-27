/**
 * What the check found, under the address it checked (canvas F03 f5): a check mark, one
 * sentence, and "Change", which puts the cursor back in the address.
 *
 * The address stays in its own field above, so the person sees what they typed while the
 * connection is named and credentialed.
 */
import {useT, type CatalogKey} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {Button} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"

/** How the server said it authorizes. `none` is a server that asked for nothing. */
export type ProbeResultMode = "oauth" | "api_key" | "none"

/**
 * The sentence, one per answer the probe can give.
 *
 * Kept here rather than at the call sites so the screens cannot drift into several wordings
 * for the same finding.
 */
const SUMMARY: Record<ProbeResultMode, CatalogKey<typeof mcpConnectCatalog>> = {
    oauth: "entityUi.mcpConnect.reachableOauth",
    api_key: "entityUi.mcpConnect.reachableApiKey",
    none: "entityUi.mcpConnect.reachableNone",
}

export interface ProbeResultCardProps {
    mode: ProbeResultMode
    /** Back to the address. Omitted where the address is not this journey's to change. */
    onChange?: () => void
}

export const ProbeResultCard = ({mode, onChange}: ProbeResultCardProps) => {
    const t = useT(mcpConnectCatalog)
    return (
        <div
            data-testid="mcp-probe-result"
            // Canvas F03 f5: radius 8, the check in a 16 px green tile.
            className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5"
        >
            <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-success/10 text-success">
                <Check size={12} />
            </span>
            <span className="min-w-0 flex-1 truncate text-label leading-5 text-foreground">
                {t(SUMMARY[mode])}
            </span>
            {onChange ? (
                <Button
                    variant="ghost"
                    size="xs"
                    // The negative margins keep the 24px box on its 20px line, the text in line.
                    className="-my-0.5 -mr-1.5 shrink-0 text-foreground"
                    onClick={onChange}
                >
                    {t("entityUi.mcpConnect.change")}
                </Button>
            ) : null}
        </div>
    )
}

export default ProbeResultCard
