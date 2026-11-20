/**
 * What the check found, under the address it checked (canvas F03 f5): a check mark, one
 * sentence, and "Change", which puts the cursor back in the address.
 *
 * The address stays in its own field above, so the person sees what they typed while the
 * connection is named and credentialed.
 */
import {useT, type CatalogKey} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {Button, cn, touchTargetExpansion} from "@agenta/ui/ui"
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
            className="flex items-center gap-2.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer px-3.5 py-2.5"
        >
            <Check size={12} weight="bold" className="shrink-0 text-colorSuccess" />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-colorText">
                {t(SUMMARY[mode])}
            </span>
            {onChange ? (
                <Button
                    variant="link"
                    size="xs"
                    // The control scale's 24px is under the 44px touch minimum, so the invisible
                    // expansion carries the rest. The negative margin keeps the box at its 20px line.
                    className={cn(
                        "-my-0.5 shrink-0 px-0 text-[12px] leading-4 text-colorText underline underline-offset-2",
                        touchTargetExpansion(24),
                    )}
                    onClick={onChange}
                >
                    {t("entityUi.mcpConnect.change")}
                </Button>
            ) : null}
        </div>
    )
}

export default ProbeResultCard
