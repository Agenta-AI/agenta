import {useState} from "react"

import {
    isConnectionActive,
    isConnectionValid,
    toolCatalogActionsInfiniteFamily,
    toolIntegrationDetailQueryFamily,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {useUserDisplayName} from "@agenta/entities/shared"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import {timeAgo} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import {BottomSheet, PHONE_BUTTON_CLASS, useIsPhone} from "@agenta/ui/phone"
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretDown, Lightning} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Image from "next/image"

import {OwnerChip} from "../../accounts/OwnerChip"

export interface IntegrationConnectionDetailProps {
    connection: ToolConnection
    /** The app's name and logo, as the catalog row shows them. */
    name: string
    logo: string | null
    /** Run one of the app's actions with this connection. */
    onTest?: () => void
    /** Sign in again, for a connection that stopped working. */
    onReconnect?: () => void
    /** The dialog has closed: the host drops it. */
    onClosed: () => void
}

const ACTION_PREVIEW = 10

const stamp = (value?: string | null) => (value ? timeAgo(Date.parse(value)) : "")

/** A connected app at a glance: owner, status, who connected it, and what agents can do. */
export const IntegrationConnectionDetail = ({
    connection,
    name,
    logo,
    onTest,
    onReconnect,
    onClosed,
}: IntegrationConnectionDetailProps) => {
    const t = useT(commonCatalog, integrationDrawerCatalog)
    const phone = useIsPhone()
    const [open, setOpen] = useState(true)
    const [showActions, setShowActions] = useState(false)
    const close = () => setOpen(false)

    const integration = useAtomValue(toolIntegrationDetailQueryFamily(connection.integration_key))
        .data?.integration
    const actionsQuery = useAtomValue(toolCatalogActionsInfiniteFamily(connection.integration_key))
    const firstPage = actionsQuery.data?.pages?.[0]
    const actions = (firstPage?.actions ?? []).slice(0, ACTION_PREVIEW)
    const actionTotal = firstPage?.total ?? integration?.actions_count ?? actions.length

    const connectedBy = useUserDisplayName(connection.created_by_id)
    const connectedWhen = stamp(connection.created_at)
    const works = isConnectionActive(connection) && isConnectionValid(connection)
    const scheme = String(connection.data?.auth_scheme ?? "")
    const signsIn = /oauth/i.test(scheme)
        ? t("entityUi.integrationDrawer.authAccount")
        : scheme
          ? t("entityUi.integrationDrawer.authKey")
          : null
    const kind = integration?.categories?.[0] ?? null
    const lastChanged = stamp(connection.updated_at ?? connection.created_at)
    const url = integration?.url ?? null

    const facts = [
        signsIn ? {label: t("entityUi.integrationDrawer.signsInWith"), value: signsIn} : null,
        kind ? {label: t("entityUi.integrationDrawer.kindOfApp"), value: kind} : null,
        lastChanged ? {label: t("entityUi.integrationDrawer.lastChanged"), value: lastChanged} : null,
    ].filter((fact): fact is {label: string; value: string} => Boolean(fact))

    const statusLine = (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta">
            <span className={works ? "text-success" : "text-warning"}>
                <span aria-hidden className="mr-1 inline-block size-1.5 rounded-round bg-current align-middle" />
                {works ? t("common.connected") : t("entityUi.integrationDrawer.needsSignInAgain")}
            </span>
            {connectedWhen ? (
                <span className="text-muted-foreground">
                    ·{" "}
                    {connectedBy
                        ? t("entityUi.integrationDrawer.connectedByWhen", {
                              name: connectedBy,
                              when: connectedWhen,
                          })
                        : t("entityUi.integrationDrawer.connectedWhen", {when: connectedWhen})}
                </span>
            ) : null}
        </span>
    )

    const body = (
        <div className="flex flex-col gap-4">
            {facts.length ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
                    {facts.map((fact) => (
                        <div key={fact.label} className="flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2">
                            <span className="text-meta text-muted-foreground">{fact.label}</span>
                            <span className="truncate text-label text-foreground">{fact.value}</span>
                        </div>
                    ))}
                </div>
            ) : null}
            {actionTotal ? (
                <div className="flex flex-col">
                    <Button
                        variant="ghost"
                        className="-mx-2 justify-between px-2"
                        aria-expanded={showActions}
                        onClick={() => setShowActions((value) => !value)}
                    >
                        <span className="flex items-center gap-2">
                            <Lightning size={14} className="text-muted-foreground" />
                            {t("entityUi.integrationDrawer.agentsCanDo", {count: actionTotal})}
                        </span>
                        <span className="flex items-center gap-1 text-meta text-muted-foreground">
                            {showActions
                                ? t("entityUi.integrationDrawer.hide")
                                : t("entityUi.integrationDrawer.show")}
                            <CaretDown
                                size={12}
                                className={`transition-transform duration-[var(--duration-fast)] ${
                                    showActions ? "rotate-180" : ""
                                }`}
                            />
                        </span>
                    </Button>
                    <HeightCollapse open={showActions}>
                        <div className="flex flex-wrap gap-1.5 pt-2">
                            {actions.map((action) => (
                                <span
                                    key={action.key}
                                    title={action.description ?? undefined}
                                    className="rounded-md bg-muted px-2 py-0.5 text-meta text-foreground"
                                >
                                    {action.name}
                                </span>
                            ))}
                            {actionTotal > actions.length ? (
                                <span className="px-1 py-0.5 text-meta text-muted-foreground">
                                    {t("entityUi.integrationDrawer.moreCount", {
                                        count: actionTotal - actions.length,
                                    })}
                                </span>
                            ) : null}
                        </div>
                    </HeightCollapse>
                </div>
            ) : null}
        </div>
    )

    const primary = works ? (
        onTest ? (
            <Button
                variant="outline"
                className={phone ? PHONE_BUTTON_CLASS : undefined}
                onClick={() => {
                    close()
                    onTest()
                }}
            >
                {t("entityUi.integrationDrawer.testConnection")}
            </Button>
        ) : null
    ) : onReconnect ? (
        <Button
            className={phone ? PHONE_BUTTON_CLASS : undefined}
            onClick={() => {
                close()
                onReconnect()
            }}
        >
            {t("common.reconnect")}
        </Button>
    ) : null

    const appLink = url ? (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-label text-muted-foreground no-underline hover:text-foreground"
        >
            {t("entityUi.integrationDrawer.openApp", {name})}
            <ArrowSquareOut size={12} />
        </a>
    ) : (
        <span />
    )

    const mark = (
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {logo ? (
                <Image src={logo} alt="" width={20} height={20} className="size-5 object-contain" unoptimized />
            ) : (
                <span className="text-label font-medium text-muted-foreground">
                    {name.charAt(0).toUpperCase()}
                </span>
            )}
        </span>
    )
    const owner = connection.user_id ? "user" : "project"

    if (phone) {
        return (
            <BottomSheet
                open={open}
                onOpenChange={(next) => (next ? undefined : close())}
                title={name}
                showTitle
                onCloseAutoFocus={onClosed}
            >
                <div className="flex flex-col gap-4 px-4 pb-4">
                    <div className="flex items-center gap-2">
                        <OwnerChip owner={owner} />
                        {statusLine}
                    </div>
                    {body}
                    {primary}
                    {url ? <div className="flex justify-center">{appLink}</div> : null}
                </div>
            </BottomSheet>
        )
    }
    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
            <DialogContent onCloseAutoFocus={onClosed}>
                <DialogHeader>
                    <span className="flex min-w-0 items-center gap-3">
                        {mark}
                        <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-2">
                                <DialogTitle className="truncate">{name}</DialogTitle>
                                <OwnerChip owner={owner} />
                            </span>
                            {statusLine}
                        </span>
                    </span>
                </DialogHeader>
                {body}
                <DialogFooter className="items-center sm:justify-between">
                    {appLink}
                    <span className="flex items-center gap-2">
                        {primary}
                        <Button onClick={close}>{t("common.done")}</Button>
                    </span>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
