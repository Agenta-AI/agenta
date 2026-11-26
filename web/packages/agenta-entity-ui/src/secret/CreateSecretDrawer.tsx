/**
 * CreateSecretDrawer — an in-flow "create a project secret" surface.
 *
 * A stacked Sheet that renders the SAME `SecretForm` the Settings modal uses, so a
 * user configuring (e.g.) an MCP server can add a missing secret without leaving the flow. On
 * save the secret is written to the project vault and handed back via `onCreated` so the caller
 * can select it in its draft.
 */
import {useT} from "@agenta/i18n"
import secretFormCatalog from "@agenta/i18n/catalogs/entityUi.secretForm"
import {toEnvVarName} from "@agenta/shared/utils"
import {
    Button,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"

import {DrawerFooter} from "../drawers/shared/DrawerFooter"

import {SecretForm, useSecretForm, type SavedSecret} from "./SecretForm"

export interface CreateSecretDrawerProps {
    open: boolean
    onClose: () => void
    /** Raw header name the secret is for; seeds the Name when there is no server name. */
    headerName?: string
    /** Server name; seeds the Name as `<SERVER>_<nameSuffix>`. */
    serverName?: string
    /** What the secret is to the server. @default "API_KEY" */
    nameSuffix?: string
    /** Seeds the value, for a caller that built it (the MCP Basic helper). */
    initialValue?: string
    /** Called with the persisted secret after a successful save. */
    onCreated: (row: SavedSecret) => void
    /** Stacks above the host drawer. @default 1100 */
    zIndex?: number
}

export function CreateSecretDrawer({
    open,
    onClose,
    headerName,
    serverName,
    nameSuffix = "API_KEY",
    initialValue,
    onCreated,
    zIndex = 1100,
}: CreateSecretDrawerProps) {
    const t = useT(secretFormCatalog)
    // Default to the server's env var for this secret, falling back to the header name.
    const serverEnv = toEnvVarName(serverName ?? "")
    const suggestedName = serverEnv ? `${serverEnv}_${nameSuffix}` : toEnvVarName(headerName ?? "")

    const controller = useSecretForm({
        open,
        initialName: suggestedName,
        initialValue,
        onSaved: (row) => {
            onCreated(row)
            onClose()
        },
    })

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose()
            }}
        >
            <SheetContent
                side="right"
                className="ag-drawer-elevated"
                style={{width: 600, maxWidth: "calc(100% - 1rem)", zIndex}}
            >
                {/* The header carries its own Back arrow, so the built-in close would duplicate it. */}
                <SheetHeader showCloseButton={false}>
                    <div className="flex min-w-0 items-center gap-2">
                        <SimpleTooltip title={t("entityUi.secretForm.back")}>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("entityUi.secretForm.back")}
                                onClick={onClose}
                                className="shrink-0"
                            >
                                <ArrowLeft size={14} />
                            </Button>
                        </SimpleTooltip>
                        <div className="min-w-0">
                            <SheetTitle className="truncate text-label font-medium">
                                {t("entityUi.secretForm.createSecret")}
                            </SheetTitle>
                            <div className="truncate text-meta font-normal text-muted-foreground">
                                {t("entityUi.secretForm.availableToEveryAgent")}
                            </div>
                        </div>
                    </div>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto p-4 text-field-md text-foreground">
                    <SecretForm controller={controller} popupZIndex={zIndex + 1} />
                </div>
                {/* `DrawerFooter` brings its own rule and padding. */}
                <SheetFooter className="block border-0 p-0">
                    <DrawerFooter
                        left={
                            <span className="min-w-0 truncate text-meta text-muted-foreground">
                                {t("entityUi.secretForm.savedThenSelected")}
                            </span>
                        }
                        onCancel={onClose}
                        isMutating={controller.saving}
                        canSave={!controller.okDisabled}
                        submitLabel={t("entityUi.secretForm.save")}
                        onSubmit={controller.submit}
                    />
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
