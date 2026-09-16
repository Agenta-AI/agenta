import {memo} from "react"

import {sidebarSessionSearchOpenAtom} from "@agenta/navigation"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

/**
 * Opens the session search, from the Sessions group row.
 *
 * It sits beside the filter menu because the two answer the same question at different scales:
 * the filter narrows what the rail lists, this reaches past it.
 */
const SessionSearchButton = () => {
    const setOpen = useSetAtom(sidebarSessionSearchOpenAtom)
    return (
        <span
            role="button"
            tabIndex={0}
            aria-label="Search sessions"
            title="Search sessions"
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-colorTextTertiary outline-none hover:bg-colorFillQuaternary hover:text-colorText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
            onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setOpen(true)
            }}
            onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                event.stopPropagation()
                setOpen(true)
            }}
        >
            <MagnifyingGlass size={12} />
        </span>
    )
}

export default memo(SessionSearchButton)
