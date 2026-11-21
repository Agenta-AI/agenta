import {useCallback} from "react"

import {loadWithText} from "@agenta/i18n"
import {useAtom} from "jotai"
import {AnimatePresence, motion} from "motion/react"
import dynamic from "next/dynamic"

import {useMotionPresets} from "@/lib/motion/presets"

import {postAuthBootAtom} from "./postAuthBoot"

/** Shown once after sign-in, so its code and text stay out of every page's first load. */
const BootLoaderScreen = dynamic(
    () => loadWithText(() => import("./BootLoaderScreen")).then((m) => m.BootLoaderScreen),
    {
        ssr: false,
    },
)

/** One loader over every route change between sign-in and the first real screen. */
export const PostAuthLoader = () => {
    const [boot, setBoot] = useAtom(postAuthBootAtom)
    const presets = useMotionPresets()
    const finish = useCallback(() => setBoot(null), [setBoot])

    return (
        <AnimatePresence>
            {boot ? (
                <motion.div
                    key="post-auth-boot"
                    variants={presets.overlayFade}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="fixed inset-0 z-[100]"
                >
                    <BootLoaderScreen boot={boot} onDone={finish} />
                </motion.div>
            ) : null}
        </AnimatePresence>
    )
}
