/**
 * CreateSecretDrawer — an in-flow "create a project secret" surface.
 *
 * A stacked `EnhancedDrawer` that renders the SAME `SecretForm` the Settings modal uses, so a
 * user configuring (e.g.) an MCP server can add a missing secret without leaving the flow. On
 * save the secret is written to the project vault and handed back via `onCreated` so the caller
 * can select it in its draft.
 */
import {toEnvVarName} from "@agenta/shared/utils"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"

import {DrawerFooter} from "../drawers/shared/DrawerFooter"

import {SecretForm, useSecretForm, type SavedSecret} from "./SecretForm"

export interface CreateSecretDrawerProps {
    open: boolean
    onClose: () => void
    /** Raw header name the secret is for; seeds the Name when there is no server name. */
    headerName?: string
    /** Server name; seeds the Name as `<SERVER>_API_KEY`. */
    serverName?: string
    /** Called with the persisted secret after a successful save. */
    onCreated: (row: SavedSecret) => void
    /** Stacks above the host drawer. @default 1100 */
    zIndex?: number
}

/** `DrawerFooter` brings its own rule and padding, so the footer slot must add neither. */
const FOOTER_STYLE = {padding: 0, border: 0, display: "block"} as const

export function CreateSecretDrawer({
    open,
    onClose,
    headerName,
    serverName,
    onCreated,
    zIndex = 1100,
}: CreateSecretDrawerProps) {
    // Default to the server's API-key env var, falling back to the header name.
    const serverEnv = toEnvVarName(serverName ?? "")
    const suggestedName = serverEnv ? `${serverEnv}_API_KEY` : toEnvVarName(headerName ?? "")

    const controller = useSecretForm({
        open,
        initialName: suggestedName,
        onSaved: (row) => {
            onCreated(row)
            onClose()
        },
    })

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={600}
            zIndex={zIndex}
            closeOnLayoutClick={false}
            // The header carries its own Back arrow — the built-in close would duplicate it.
            closable={false}
            destroyOnClose
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Back"
                        onClick={onClose}
                        className="shrink-0"
                    >
                        <ArrowLeft size={14} />
                    </Button>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">Create secret</div>
                        <div className="truncate text-xs font-normal text-[var(--ag-zinc-5)]">
                            Available to every agent in this project
                        </div>
                    </div>
                </div>
            }
            footer={
                <DrawerFooter
                    left={
                        <span className="min-w-0 truncate text-xs text-[var(--ag-zinc-5)]">
                            Saved to the project, then selected here
                        </span>
                    }
                    onCancel={onClose}
                    isMutating={controller.saving}
                    canSave={!controller.okDisabled}
                    submitLabel="Save"
                    onSubmit={controller.submit}
                />
            }
            styles={{body: {padding: 16}, footer: FOOTER_STYLE}}
        >
            <SecretForm controller={controller} />
        </EnhancedDrawer>
    )
}
