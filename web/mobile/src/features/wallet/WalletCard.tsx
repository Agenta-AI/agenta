import type {ReactNode} from "react"

import {motion} from "motion/react"

import {useCardTilt} from "./useCardTilt"
import {formatUsd, MUSD_PER_CREDIT} from "./walletFormat"

import {useMotionPresets} from "@/lib/motion/presets"
import {useCountUp} from "@/lib/motion/useCountUp"
import {cn} from "@/lib/utils"

/** The Agenta mark, drawn in the card's ink. */
const MARK =
    "M115.504 95.9335C115.221 98.4384 116.607 99.1695 118.671 98.2233C124.787 95.4184 149.253 82.6572 162.347 82.6572C166.663 82.6572 184.04 84.7181 149.838 117.918C121.062 145.85 113.265 139.835 111.236 137.807C105.889 132.459 108.817 117.798 109.715 110.453C110.039 107.807 109.134 106.985 106.571 108.131C83.5096 118.441 40.4169 140 16.5021 140C-29.3433 140 33.8427 64.9164 43.6743 52.9651C76.3083 13.2951 97.3726 0 109.234 0C130.713 0 121.893 39.2078 115.504 95.9335Z"

export const WALLET_CARD_COPY = {
    brand: "Agenta",
    label: "Wallet",
    balance: "Balance",
    unit: "credits",
    usage: (usd: string) => `≈ ${usd} in usage`,
    rate: (usd: string) => `1 credit = ${usd}`,
    active: "Active",
}

const copy = WALLET_CARD_COPY

export interface WalletCardProps {
    /** Spendable balance in micro-USD; `null` shows `emptyHint` in its place. */
    balanceMusd: number | null
    /** Shown when there is no balance to report. */
    emptyHint?: ReactNode
    /** Footer status; `null` hides it. */
    status?: ReactNode
    /** Count the balance up from zero on mount. */
    countUp?: boolean
    /** Tilt in and sweep a shine on mount. */
    entrance?: boolean
    /** Tilt toward the pointer with a glare. */
    interactive?: boolean
    /** Soft glow under the card. */
    glow?: boolean
    className?: string
}

/** The wallet as a payment card: balance, its USD value and the credit rate. Data-free. */
export const WalletCard = ({
    balanceMusd,
    emptyHint,
    status = copy.active,
    countUp = false,
    entrance = false,
    interactive = false,
    glow = false,
    className,
}: WalletCardProps) => {
    const presets = useMotionPresets()
    const moves = !presets.reduced
    const {tilt, onPointerMove, onPointerLeave} = useCardTilt(interactive && moves)
    const credits = useCountUp(
        (balanceMusd ?? 0) / MUSD_PER_CREDIT,
        countUp && moves ? presets.countUpMs : 0,
    )

    return (
        <div className={cn("relative", className)}>
            {glow ? (
                <motion.div
                    aria-hidden
                    animate={{x: -tilt.ry * 0.9}}
                    transition={presets.tiltSettle}
                    className="bg-hero-action-hover/40 absolute inset-x-[8%] -bottom-[18px] h-10 rounded-full blur-[24px]"
                />
            ) : null}
            <motion.div
                onPointerMove={onPointerMove}
                onPointerLeave={onPointerLeave}
                initial={entrance && moves ? {opacity: 0, rotateX: 24, rotateY: -12} : false}
                animate={{
                    opacity: 1,
                    rotateX: tilt.rx,
                    rotateY: tilt.ry,
                    scale: tilt.hover ? 1.03 : 1,
                }}
                transition={tilt.hover ? presets.tiltFollow : presets.tiltSettle}
                style={{transformPerspective: 900}}
                className="bg-hero-action text-hero-action-foreground ring-hero-action-foreground/10 relative box-border flex aspect-[1.586] flex-col justify-between overflow-hidden rounded-2xl px-[18px] py-4 shadow-sm ring-1 ring-inset will-change-transform"
            >
                {interactive ? (
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 z-[2] rounded-2xl transition-opacity duration-300 motion-reduce:transition-none"
                        style={{
                            opacity: tilt.hover ? 1 : 0,
                            background: `radial-gradient(circle at ${tilt.gx}% ${tilt.gy}%, rgb(255 255 255 / 0.6) 0%, rgb(255 255 255 / 0.18) 28%, transparent 60%)`,
                        }}
                    />
                ) : null}
                <svg
                    aria-hidden
                    viewBox="0 0 171 140"
                    className="absolute -bottom-[30%] -right-[18%] h-auto w-[78%] opacity-[0.08]"
                >
                    <path fill="currentColor" d={MARK} />
                </svg>
                {entrance && moves ? (
                    <motion.span
                        aria-hidden
                        initial={{x: "-120%", skewX: -18}}
                        animate={{x: "320%", skewX: -18}}
                        transition={presets.shineSweep}
                        className="absolute inset-y-0 left-0 w-[28%] bg-gradient-to-r from-transparent via-white/50 to-transparent"
                    />
                ) : null}
                <div className="relative flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <svg aria-hidden viewBox="0 0 171 140" width="20" height="16">
                            <path fill="currentColor" d={MARK} />
                        </svg>
                        <span className="text-[13px] font-semibold leading-[18px]">
                            {copy.brand}
                        </span>
                    </span>
                    <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.04em] opacity-75">
                        {copy.label}
                    </span>
                </div>
                {balanceMusd === null ? (
                    <span className="relative text-[13px] leading-[18px] opacity-75">
                        {emptyHint}
                    </span>
                ) : (
                    <div className="relative flex flex-col gap-0.5">
                        <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.04em] opacity-75">
                            {copy.balance}
                        </span>
                        <span className="flex items-baseline gap-2">
                            <span className="text-[40px] font-semibold tabular-nums leading-[44px] tracking-[-0.035em]">
                                {Math.round(credits).toLocaleString()}
                            </span>
                            <span className="text-[15px] font-medium leading-5">{copy.unit}</span>
                        </span>
                        <span className="text-[13px] tabular-nums leading-[18px] opacity-75">
                            {copy.usage(formatUsd(credits * MUSD_PER_CREDIT))}
                        </span>
                    </div>
                )}
                <div className="relative flex items-center justify-between border-0 border-t border-solid border-current/15 pt-3">
                    <span className="text-xs leading-4 opacity-75">
                        {copy.rate(formatUsd(MUSD_PER_CREDIT))}
                    </span>
                    {status === null ? null : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium leading-4">
                            <span className="bg-success size-1.5 rounded-full" />
                            {status}
                        </span>
                    )}
                </div>
            </motion.div>
        </div>
    )
}
