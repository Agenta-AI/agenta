import {useState, type ReactNode} from "react"

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
import accountsCatalog from "@agenta/i18n/catalogs/entityUi.accounts"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import {timeAgo} from "@agenta/shared/utils"
import {BottomSheet, PHONE_BUTTON_CLASS, useIsPhone} from "@agenta/ui/phone"
import {Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from "@agenta/ui/ui"
import {ArrowSquareOut, Lightning} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Image from "next/image"

import {OwnerChip} from "../../accounts/OwnerChip"

export interface IntegrationConnectionDetailProps {
    connection: ToolConnection
    /** The app's name and logo, as the catalog row shows them. */
    name: string
    logo: string | null
    /** Sign in again, for a connection that stopped working. */
    onReconnect?: () => void
    /** The dialog has closed: the host drops it. */
    onClosed: () => void
}

const ACTION_PREVIEW = 8

const stamp = (value?: string | null) => (value ? timeAgo(Date.parse(value)) : "")

/** A connected app at a glance: owner, status, who connected it, and what agents can do. */
export const IntegrationConnectionDetail = ({
    connection,
    name,
    logo,
    onReconnect,
    onClosed,
}: IntegrationConnectionDetailProps) => {
    const t = useT(commonCatalog, accountsCatalog, integrationDrawerCatalog)
    const phone = useIsPhone()
    const [open, setOpen] = useState(true)
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
    const url = integration?.url ?? null

    const owner = connection.user_id ? "user" : "project"
    const allFacts: ({label: string; value: ReactNode} | null)[] = [
        {label: t("entityUi.accounts.owner"), value: <OwnerChip owner={owner} />},
        signsIn ? {label: t("entityUi.integrationDrawer.signsInWith"), value: signsIn} : null,
        kind ? {label: t("entityUi.integrationDrawer.kindOfApp"), value: kind} : null,
    ]
    const facts = allFacts.filter((fact): fact is {label: string; value: ReactNode} =>
        Boolean(fact),
    )

    const statusLine = (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta">
            <span className={works ? "text-success" : "text-warning"}>
                <span
                    aria-hidden
                    className="mr-1 inline-block size-1.5 rounded-round bg-current align-middle"
                />
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
                        <div
                            key={fact.label}
                            className="flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2"
                        >
                            <span className="text-meta text-muted-foreground">{fact.label}</span>
                            <span className="flex min-w-0 truncate text-label text-foreground">
                                {fact.value}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}
            {actionTotal ? (
                <section className="flex flex-col gap-2">
                    <span className="flex items-baseline gap-1.5 text-label">
                        <span className="font-medium text-foreground">
                            {t("entityUi.integrationDrawer.whatAgentsCanDo")}
                        </span>
                        <span className="text-muted-foreground">{actionTotal}</span>
                    </span>
                    <ul className="m-0 grid list-none grid-cols-1 gap-x-4 gap-y-1.5 p-0 sm:grid-cols-2">
                        {actions.map((action) => (
                            <li
                                key={action.key}
                                title={action.description ?? undefined}
                                className="flex min-w-0 items-center gap-2 text-label text-foreground"
                            >
                                <Lightning
                                    size={12}
                                    aria-hidden
                                    className="shrink-0 text-muted-foreground"
                                />
                                <span className="truncate">{action.name}</span>
                            </li>
                        ))}
                    </ul>
                    {actionTotal > actions.length ? (
                        <span className="text-meta text-muted-foreground">
                            {t("entityUi.integrationDrawer.moreCount", {
                                count: actionTotal - actions.length,
                            })}
                        </span>
                    ) : null}
                </section>
            ) : null}
        </div>
    )

    const primary = works ? null : onReconnect ? (
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
                <Image
                    src={logo}
                    alt=""
                    width={20}
                    height={20}
                    className="size-5 object-contain"
                    unoptimized
                />
            ) : (
                <span className="text-label font-medium text-muted-foreground">
                    {name.charAt(0).toUpperCase()}
                </span>
            )}
        </span>
    )
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
                    {statusLine}
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
                            <DialogTitle className="truncate">{name}</DialogTitle>
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
