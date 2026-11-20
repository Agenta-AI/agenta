/** The drawer shell around the permission list, for hosts that keep a drawer (MCP server permissions). */
import type {Ref} from "react"

import {useT} from "@agenta/i18n"
import permissionDrawerCatalog from "@agenta/i18n/catalogs/entityUi.permissionDrawer"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "@agenta/ui/ui"

import {ToolPermissionsSkeleton} from "../DrawerSkeletons"
import type {GatewayConnectionPermissions} from "../toolUtils"

import {INTEGRATION_DRAWER_WIDTH} from "./drawerWidths"
import {
    IntegrationDrawerBody,
    IntegrationTitle,
    PermissionDrawerBody,
    UnmigratedNotice,
    type IntegrationPermissionListProps,
    type PermissionDrawerSource,
} from "./IntegrationPermissionList"

// The drawer's props name these; the MCP permission drawer reads them from here.
export type {
    PermissionDrawerCatalog,
    PermissionDrawerSource,
    PermissionPresetOption,
    PermissionPresetSource,
} from "./IntegrationPermissionList"

export interface IntegrationPermissionDrawerProps
    extends Omit<IntegrationPermissionListProps, "permissions"> {
    open: boolean
    onClose: () => void
    /** Null when the integration has no connection entry — its legacy entries span two connections
     *  and could not be converted, so there is no single policy to edit. */
    permissions: GatewayConnectionPermissions | null
    /** Renders a non-Composio source through the same body. */
    source?: PermissionDrawerSource
    /** The drawer's panel element, so a dialog opened from it can open inside it. */
    panelRef?: Ref<HTMLDivElement>
}

export function IntegrationPermissionDrawer({
    open,
    onClose,
    source,
    panelRef,
    ...body
}: IntegrationPermissionDrawerProps) {
    const t = useT(permissionDrawerCatalog)
    const readOnly = source?.readOnly ?? false

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            // The side on every screen, as every playground drawer opens; the width clamps on a phone.
            placement="right"
            width={INTEGRATION_DRAWER_WIDTH}
            destroyOnClose
            bodyFallback={<ToolPermissionsSkeleton />}
            panelRef={panelRef}
            title={
                source?.title ?? (
                    <IntegrationTitle target={body.target} connectionSlug={body.connectionSlug} />
                )
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                readOnly ? undefined : (
                    // items-end, not items-center: the left column grows downward when an inline
                    // confirm opens under its link, and Done stays on the bottom line with it.
                    // w-full: the sheet footer is a flex row, so without it there is no space to
                    // push the destructive action away from Done.
                    <div className="flex w-full items-end justify-between gap-2">
                        <div className="flex min-w-0 flex-col items-start gap-2">
                            {source?.footerStart}
                        </div>
                        <Button variant="default" onClick={onClose}>
                            {t("entityUi.permissionDrawer.done")}
                        </Button>
                    </div>
                )
            }
        >
            {!body.permissions ? (
                <UnmigratedNotice target={body.target} />
            ) : source ? (
                <PermissionDrawerBody
                    {...body}
                    permissions={body.permissions}
                    catalog={source.catalog}
                    catalogKey={source.catalogKey}
                    emptyLabel={source.emptyLabel}
                    searchCount={source.searchCount}
                    readOnlyLabel={source.readOnlyLabel}
                    writeLabel={source.writeLabel}
                    staleLabel={source.staleLabel}
                    toolOptions={source.toolOptions}
                    presets={source.presets}
                    lockedTool={source.lockedTool}
                    rowValue={source.rowValue}
                    banner={source.banner}
                    controlsDisabled={source.controlsDisabled}
                    footNote={source.footNote}
                    readOnly={source.readOnly}
                    account={body.account}
                />
            ) : (
                <IntegrationDrawerBody {...body} permissions={body.permissions} />
            )}
        </EnhancedDrawer>
    )
}

