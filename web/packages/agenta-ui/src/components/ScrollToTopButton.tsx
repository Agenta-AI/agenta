import {type RefObject, useEffect, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {ArrowUp} from "@phosphor-icons/react"

interface ScrollToTopButtonProps {
    scrollRef: RefObject<HTMLDivElement | null>
}

export default function ScrollToTopButton({scrollRef}: ScrollToTopButtonProps) {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        const onScroll = () => {
            setVisible(el.scrollTop > 300)
        }
        el.addEventListener("scroll", onScroll, {passive: true})
        return () => el.removeEventListener("scroll", onScroll)
    }, [scrollRef])

    if (!visible) return null

    return (
        <div className="sticky bottom-4 flex justify-end pointer-events-none">
            <Button
                aria-label="Scroll to top"
                className="pointer-events-auto shadow-[0_2px_8px_rgba(0,0,0,0.15)] rounded-full"
                onClick={() => scrollRef.current?.scrollTo({top: 0, behavior: "smooth"})}
                variant="outline"
                size="icon"
            >
                {<ArrowUp size={16} />}
            </Button>
        </div>
    )
}
