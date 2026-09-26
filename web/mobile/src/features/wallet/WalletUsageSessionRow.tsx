import {useState} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"

import type {WalletUsageSession} from "./walletApi"
import {formatCount, formatDateTime, formatMusd, formatUsdExact} from "./walletFormat"

const CELL = "px-2 py-1.5 text-left align-top"

/** One session's totals; expands to every charge in it with the raw token counts. */
export const WalletUsageSessionRow = ({session}: {session: WalletUsageSession}) => {
    const [open, setOpen] = useState(false)

    return (
        <>
            <tr
                className="border-border hover:bg-accent/50 cursor-pointer border-t"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
            >
                <td className={CELL}>
                    {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
                </td>
                <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                    {formatDateTime(session.last_at)}
                </td>
                <td className={CELL}>{session.user_email ?? session.user_id ?? "—"}</td>
                <td className={CELL}>{session.agent_name ?? session.agent_id ?? "—"}</td>
                <td className={`${CELL} font-mono text-[11px]`}>
                    {session.session_id ?? "(no session)"}
                </td>
                <td className={`${CELL} text-right tabular-nums`}>{session.charge_count}</td>
                <td className={`${CELL} text-right whitespace-nowrap tabular-nums`}>
                    {formatMusd(session.amount_musd)}
                    <div className="text-muted-foreground">
                        {formatUsdExact(session.amount_musd)}
                    </div>
                </td>
            </tr>
            {open ? (
                <tr className="bg-muted/40">
                    <td />
                    <td colSpan={6} className="px-2 pb-3">
                        <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                                <thead className="text-muted-foreground">
                                    <tr>
                                        <th className={CELL}>Time</th>
                                        <th className={CELL}>Model / resource</th>
                                        <th className={`${CELL} text-right`}>Input</th>
                                        <th className={`${CELL} text-right`}>Output</th>
                                        <th className={`${CELL} text-right`}>Cache read</th>
                                        <th className={`${CELL} text-right`}>Cache write</th>
                                        <th className={`${CELL} text-right`}>Amount</th>
                                        <th className={CELL}>Price version</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {session.charges.map((charge) => (
                                        <tr
                                            key={charge.measurement_id ?? charge.created_at}
                                            className="border-border border-t"
                                        >
                                            <td className={`${CELL} whitespace-nowrap`}>
                                                {formatDateTime(charge.created_at)}
                                            </td>
                                            <td className={`${CELL} font-mono`}>
                                                {charge.resource_key}
                                            </td>
                                            <td className={`${CELL} text-right tabular-nums`}>
                                                {formatCount(charge.input_tokens)}
                                            </td>
                                            <td className={`${CELL} text-right tabular-nums`}>
                                                {formatCount(charge.output_tokens)}
                                            </td>
                                            <td className={`${CELL} text-right tabular-nums`}>
                                                {formatCount(charge.cache_read_tokens)}
                                            </td>
                                            <td className={`${CELL} text-right tabular-nums`}>
                                                {formatCount(charge.cache_write_tokens)}
                                            </td>
                                            <td
                                                className={`${CELL} text-right whitespace-nowrap tabular-nums`}
                                            >
                                                {formatMusd(charge.amount_musd)} ·{" "}
                                                {formatUsdExact(charge.amount_musd)}
                                            </td>
                                            <td className={`${CELL} font-mono`}>
                                                {charge.pricing_version}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            ) : null}
        </>
    )
}
