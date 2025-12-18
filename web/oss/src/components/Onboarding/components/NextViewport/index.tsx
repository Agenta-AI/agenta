import {forwardRef, useEffect, useRef, type MutableRefObject, type ReactNode} from "react"

import clsx from "clsx"

interface NextViewportProps {
    id: string
    className?: string
    children: ReactNode
}

const NextViewport = forwardRef<HTMLDivElement, NextViewportProps>(
    ({id, className, children}, forwardedRef) => {
        const containerRef = useRef<HTMLDivElement | null>(null)

        useEffect(() => {
            const node = containerRef.current
            if (typeof window === "undefined" || !node) return

            let animationFrame: number | null = null
            const notifyViewportChange = () => {
                window.dispatchEvent(new CustomEvent("nextstep:viewport-scroll", {detail: {id}}))
                window.dispatchEvent(new Event("resize"))
            }

            const scheduleNotification = () => {
                if (animationFrame) cancelAnimationFrame(animationFrame)
                animationFrame = window.requestAnimationFrame(() => {
                    notifyViewportChange()
                })
            }

            const resizeObserver =
                typeof ResizeObserver !== "undefined"
                    ? new ResizeObserver(() => scheduleNotification())
                    : null

            resizeObserver?.observe(node)
            node.addEventListener("scroll", scheduleNotification, {passive: true})
            scheduleNotification()

            return () => {
                node.removeEventListener("scroll", scheduleNotification)
                resizeObserver?.disconnect()
                if (animationFrame) cancelAnimationFrame(animationFrame)
            }
        }, [id])

        const setRef = (node: HTMLDivElement | null) => {
            containerRef.current = node
            if (typeof forwardedRef === "function") {
                forwardedRef(node)
            } else if (forwardedRef) {
                ;(forwardedRef as MutableRefObject<HTMLDivElement | null>).current = node
            }
        }

        return (
            <div id={id} ref={setRef} className={clsx("relative h-full w-full", className)}>
                {children}
            </div>
        )
    },
)

NextViewport.displayName = "NextViewport"

export default NextViewport
