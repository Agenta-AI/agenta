import {useCallback} from "react"

import {useAtom} from "jotai"
import {AnimatePresence, motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"

import {BootLoaderScreen} from "./BootLoaderScreen"
import {postAuthBootAtom} from "./postAuthBoot"

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
