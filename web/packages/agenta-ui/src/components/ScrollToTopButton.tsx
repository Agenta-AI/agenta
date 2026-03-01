import {type RefObject, useEffect, useState} from "react"

import {ArrowUp} from "@phosphor-icons/react"
import {Button} from "antd"

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
                type="default"
                shape="circle"
                aria-label="Scroll to top"
                icon={<ArrowUp size={16} />}
                className="pointer-events-auto shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
                onClick={() => scrollRef.current?.scrollTo({top: 0, behavior: "smooth"})}
            />
        </div>
    )
}
