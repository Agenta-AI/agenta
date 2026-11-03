import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

/** A formatted number whose changed characters flip in, blurred and staggered. Unchanged ones hold still. */
export const AnimatedNumber = ({value, className}: {value: string; className?: string}) => {
    const presets = useMotionPresets()
    const chars = Array.from(value)
    return (
        <span className={cn("inline-flex whitespace-pre tabular-nums", className)}>
            <span className="sr-only">{value}</span>
            {chars.map((char, i) => {
                // Keyed from the right so digits keep their place when the number grows a digit.
                const slot = chars.length - i
                return (
                    <motion.span
                        key={`${slot}:${char}`}
                        aria-hidden
                        className="inline-block"
                        variants={presets.digitPop}
                        custom={i * presets.digitStaggerS}
                        initial="initial"
                        animate="animate"
                    >
                        {char}
                    </motion.span>
                )
            })}
        </span>
    )
}
