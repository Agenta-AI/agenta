import {forwardRef, useCallback, useMemo, useRef} from "react"
import type {HTMLAttributes, MutableRefObject} from "react"

import clsx from "clsx"

const VisibilityAwareRow = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    function VisibilityAwareRow({className, style, children, ...rest}, forwardedRef) {
        // const [isVisible, setIsVisible] = useState(true)
        // const scrollContainer = useVirtualTableScrollContainer()
        const nodeRef = useRef<HTMLDivElement | null>(null)

        const setRefs = useCallback(
            (node: HTMLDivElement | null) => {
                nodeRef.current = node
                if (typeof forwardedRef === "function") {
                    forwardedRef(node)
                } else if (forwardedRef && typeof forwardedRef === "object") {
                    ;(forwardedRef as MutableRefObject<HTMLDivElement | null>).current = node
                }
            },
            [forwardedRef],
        )

        // useEffect(() => {
        //     const element = nodeRef.current
        //     if (!element) return undefined

        //     const root =
        //         scrollContainer ??
        //         element.closest<HTMLElement>(".ant-table-body") ??
        //         element.closest<HTMLElement>(".ant-table-container") ??
        //         null

        //     const observer = new IntersectionObserver(
        //         (entries) => {
        //             entries.forEach((entry) => {
        //                 if (entry.target === element) {
        //                     setIsVisible(entry.isIntersecting || entry.intersectionRatio > 0)
        //                 }
        //             })
        //         },
        //         {
        //             root,
        //             threshold: 0,
        //         },
        //     )

        //     observer.observe(element)
        //     return () => {
        //         observer.disconnect()
        //     }
        // }, [scrollContainer])

        const mergedClassName = useMemo(() => clsx(className), [className])

        return (
            <div {...rest} ref={setRefs} className={mergedClassName} style={style} role="row">
                {children}
            </div>
        )
    },
)

export default VisibilityAwareRow
