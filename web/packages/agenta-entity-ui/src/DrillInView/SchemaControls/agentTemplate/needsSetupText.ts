/**
 * The needs-setup words in the active language. `@agenta/entities/workflow` keeps the English
 * constants (and the reason codes); every display reads these helpers instead.
 */
import {createT, type CatalogKey} from "@agenta/i18n"
import needsSetupCatalog from "@agenta/i18n/catalogs/entityUi.needsSetup"

const tNow = createT(needsSetupCatalog)

export const needsSetupLabel = (): string => tNow("entityUi.needsSetup.label")
export const agentNeedsSetupTitle = (): string => tNow("entityUi.needsSetup.agentTitle")
export const modelNeedsSetupMessage = (): string => tNow("entityUi.needsSetup.modelMessage")
export const modelSetupPlaceholder = (): string => tNow("entityUi.needsSetup.modelPlaceholder")

const REASON_KEYS: Record<string, CatalogKey<typeof needsSetupCatalog>> = {
    not_chosen: "entityUi.needsSetup.reasonNotChosen",
    not_found: "entityUi.needsSetup.reasonNotFound",
    not_shared: "entityUi.needsSetup.reasonNotShared",
    turned_off: "entityUi.needsSetup.reasonTurnedOff",
    needs_sign_in: "entityUi.needsSetup.reasonSignInExpired",
    not_available: "entityUi.needsSetup.reasonNotAvailable",
}

/** The second line under the tag; null for a reason this client has no words for. */
export const needsSetupReasonText = (reason: string | null | undefined): string | null =>
    reason && Object.hasOwn(REASON_KEYS, reason) ? tNow(REASON_KEYS[reason]) : null
