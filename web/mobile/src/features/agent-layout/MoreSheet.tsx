import {useState, type ReactNode} from "react"

import {BottomSheetMenu, type BottomSheetMenuItem} from "@agenta/ui/phone"

/** The phone header's More menu when there is no agent menu to hold the entries. */
export const MoreSheet = ({
    title,
    trigger,
    items,
}: {
    title: string
    trigger: ReactNode
    items: BottomSheetMenuItem[]
}) => {
    const [open, setOpen] = useState(false)
    return (
        <BottomSheetMenu
            open={open}
            onOpenChange={setOpen}
            title={title}
            items={items}
            trigger={trigger}
        />
    )
}
