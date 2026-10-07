import {useState, type PointerEvent} from "react"

import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"

import {formatUsd, MUSD_PER_CREDIT} from "../wallet/walletFormat"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {useCountUp} from "./useCountUp"

const copy = ONBOARDING_COPY.model

/** The Agenta mark, drawn in the card's ink. */
const MARK =
    "M115.504 95.9335C115.221 98.4384 116.607 99.1695 118.671 98.2233C124.787 95.4184 149.253 82.6572 162.347 82.6572C166.663 82.6572 184.04 84.7181 149.838 117.918C121.062 145.85 113.265 139.835 111.236 137.807C105.889 132.459 108.817 117.798 109.715 110.453C110.039 107.807 109.134 106.985 106.571 108.131C83.5096 118.441 40.4169 140 16.5021 140C-29.3433 140 33.8427 64.9164 43.6743 52.9651C76.3083 13.2951 97.3726 0 109.234 0C130.713 0 121.893 39.2078 115.504 95.9335Z"

interface Tilt {
    rx: number
    ry: number
    gx: number
    gy: number
    hover: boolean
}

const FLAT: Tilt = {rx: 0, ry: 0, gx: 50, gy: 50, hover: false}

/**
 * The wallet as a card: the real spendable balance, counted up as the card lands. It tilts toward
 * the pointer with a glare, except under reduced motion.
 */
export const OnboardingWalletCard = ({balanceMusd}: {balanceMusd: number | null}) => {
    const presets = useMotionPresets()
    const [tilt, setTilt] = useState<Tilt>(FLAT)
    const credits = useCountUp((balanceMusd ?? 0) / MUSD_PER_CREDIT, presets.countUpMs)

    const onMove = (event: PointerEvent<HTMLDivElement>) => {
        if (presets.reduced) return
        const box = event.currentTarget.getBoundingClientRect()
        const px = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
        const py = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))
        setTilt({rx: (0.5 - py) * 18, ry: (px - 0.5) * 22, gx: px * 100, gy: py * 100, hover: true})
    }

    return (
        <div className="relative">
            <motion.div
                aria-hidden
                animate={{x: -tilt.ry * 0.9}}
                transition={presets.tiltSettle}
                className="bg-hero-action-hover/40 absolute inset-x-[8%] -bottom-[18px] h-10 rounded-full blur-[24px]"
            />
            <motion.div
                onPointerMove={onMove}
                onPointerLeave={() => setTilt(FLAT)}
                initial={presets.reduced ? false : {opacity: 0, rotateX: 24, rotateY: -12}}
                animate={{
                    opacity: 1,
                    rotateX: tilt.rx,
                    rotateY: tilt.ry,
                    scale: tilt.hover ? 1.03 : 1,
                }}
                transition={tilt.hover ? presets.tiltFollow : presets.tiltSettle}
                style={{transformPerspective: 900}}
                className="bg-hero-action text-hero-action-foreground relative box-border flex aspect-[1.586] flex-col justify-between overflow-hidden rounded-2xl px-[18px] py-4 shadow-sm ring-1 ring-inset ring-hero-action-foreground/10 will-change-transform"
            >
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-[2] rounded-2xl transition-opacity duration-300 motion-reduce:transition-none"
                    style={{
                        opacity: tilt.hover ? 1 : 0,
                        background: `radial-gradient(circle at ${tilt.gx}% ${tilt.gy}%, rgb(255 255 255 / 0.6) 0%, rgb(255 255 255 / 0.18) 28%, transparent 60%)`,
                    }}
                />
                <svg
                    aria-hidden
                    viewBox="0 0 171 140"
                    className="absolute -bottom-[30%] -right-[18%] h-auto w-[78%] opacity-[0.08]"
                >
                    <path fill="currentColor" d={MARK} />
                </svg>
                {presets.reduced ? null : (
                    <motion.span
                        aria-hidden
                        initial={{x: "-120%", skewX: -18}}
                        animate={{x: "320%", skewX: -18}}
                        transition={presets.shineSweep}
                        className="absolute inset-y-0 left-0 w-[28%] bg-gradient-to-r from-transparent via-white/50 to-transparent"
                    />
                )}
                <div className="relative flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <svg aria-hidden viewBox="0 0 171 140" width="20" height="16">
                            <path fill="currentColor" d={MARK} />
                        </svg>
                        <span className="text-[13px] font-semibold leading-[18px]">
                            {copy.cardBrand}
                        </span>
                    </span>
                    <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.04em] opacity-75">
                        {copy.cardLabel}
                    </span>
                </div>
                {balanceMusd === null ? (
                    <span className="relative text-[13px] leading-[18px] opacity-75">
                        {copy.creditsHint}
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
                            <span className="text-[15px] font-medium leading-5">
                                {copy.creditsUnit}
                            </span>
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
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium leading-4">
                        <span className="bg-success size-1.5 rounded-full" />
                        {copy.active}
                    </span>
                </div>
            </motion.div>
        </div>
    )
}
