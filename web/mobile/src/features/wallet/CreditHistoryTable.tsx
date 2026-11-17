import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import walletCreditsCatalog from "@agenta/i18n/catalogs/wallet.credits"
import walletHistoryCatalog from "@agenta/i18n/catalogs/wallet.history"
import {StatusIndicator, type StatusTone} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {ArrowSquareOut} from "@phosphor-icons/react"

import {useBillingPortal} from "../settings/useBillingPortal"

import type {WalletCredit} from "./walletApi"
import {creditKind, formatCredits, formatDate, formatUsd} from "./walletFormat"

type HistoryT = ReturnType<
    typeof useT<[typeof commonCatalog, typeof walletCreditsCatalog, typeof walletHistoryCatalog]>
>

const columns = (t: HistoryT): ListTableColumn[] => [
    {key: "credit", label: t("wallet.history.columnCredit"), width: "minmax(160px,2fr)"},
    {key: "added", label: t("wallet.history.columnAdded"), width: "minmax(96px,1fr)"},
    {
        key: "amount",
        label: t("wallet.history.columnAmount"),
        width: "minmax(72px,0.8fr)",
        headerClassName: "text-right",
    },
    {
        key: "paid",
        label: t("wallet.history.columnPaid"),
        width: "minmax(72px,0.8fr)",
        headerClassName: "text-right",
    },
    {
        key: "expires",
        label: t("wallet.history.columnExpires"),
        width: "minmax(120px,1fr)",
        headerClassName: "pl-6",
    },
    {
        key: "status",
        label: t("common.status"),
        width: "minmax(104px,1fr)",
        headerClassName: "pl-6",
    },
]

const STATUS: Record<
    "active" | "used" | "expired",
    {
        tone: StatusTone
        label: "common.active" | "wallet.history.statusUsedUp" | "wallet.history.statusExpired"
    }
> = {
    active: {tone: "success", label: "common.active"},
    used: {tone: "default", label: "wallet.history.statusUsedUp"},
    expired: {tone: "default", label: "wallet.history.statusExpired"},
}

const isExpired = (credit: WalletCredit, now: number) =>
    Boolean(credit.end_time && Date.parse(credit.end_time) <= now)

const statusOf = (credit: WalletCredit, now: number) =>
    isExpired(credit, now)
        ? STATUS.expired
        : credit.remaining_musd <= 0
          ? STATUS.used
          : STATUS.active

/** Bought packs show their price (1 credit = $0.01); grants cost nothing. */
const paidOf = (credit: WalletCredit, t: HistoryT) =>
    credit.credit_kind === "purchase"
        ? formatUsd(credit.amount_musd)
        : credit.credit_kind === "plan_allowance"
          ? t("wallet.history.included")
          : t("wallet.history.free")

/** Every credit the organization received, newest first. Invoices live in the billing portal. */
export const CreditHistoryTable = ({
    projectId,
    credits,
    showInvoices,
}: {
    projectId: string
    credits: WalletCredit[]
    showInvoices: boolean
}) => {
    const t = useT(commonCatalog, walletCreditsCatalog, walletHistoryCatalog)
    const portal = useBillingPortal(projectId)
    const now = Date.now()
    // One daily grant lands every day; past ones would bury the rest of the history.
    const rows = credits
        .filter((credit) => credit.credit_kind !== "daily_free" || !isExpired(credit, now))
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))

    return (
        <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{t("wallet.history.title")}</span>
                {showInvoices ? (
                    <button
                        type="button"
                        disabled={portal.opening}
                        onClick={portal.open}
                        className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] disabled:cursor-default disabled:opacity-60"
                    >
                        {portal.opening
                            ? t("wallet.history.opening")
                            : t("wallet.history.viewInvoices")}
                        <ArrowSquareOut size={12} />
                    </button>
                ) : null}
            </div>
            {portal.error ? (
                <span className="text-destructive text-[13px]">{portal.error}</span>
            ) : null}
            <ListTable<WalletCredit>
                columns={columns(t)}
                minWidth={680}
                groups={[{key: "credits", label: null, rows}]}
                rowKey={(credit) => credit.id}
                hideHeader={rows.length === 0}
                wrapRow={(_credit, row) => <div className="[&>*:hover]:bg-accent/60">{row}</div>}
                empty={
                    <p className="text-muted-foreground border-border/50 m-0 border-0 border-t border-solid py-3 text-[13px]">
                        {t("wallet.history.empty")}
                    </p>
                }
                renderRow={(credit) => {
                    const kind = creditKind(credit.credit_kind, t)
                    const status = statusOf(credit, now)
                    return (
                        <>
                            <span className="truncate font-medium">{kind.label}</span>
                            <span className="text-muted-foreground truncate text-[13px]">
                                {credit.created_at ? formatDate(credit.created_at) : "—"}
                            </span>
                            <span className="text-right tabular-nums">
                                {formatCredits(credit.amount_musd)}
                            </span>
                            <span className="text-muted-foreground text-right tabular-nums">
                                {paidOf(credit, t)}
                            </span>
                            <span className="text-muted-foreground whitespace-nowrap pl-6 text-[13px]">
                                {credit.end_time
                                    ? formatDate(credit.end_time)
                                    : t("wallet.history.never")}
                            </span>
                            <span className="pl-6">
                                <StatusIndicator tone={status.tone} label={t(status.label)} />
                            </span>
                        </>
                    )
                }}
            />
        </section>
    )
}
