import {useCallback, useState} from "react"

import {Popover, PopoverContent, PopoverTrigger, cn} from "@agenta/ui/ui"
import {CaretUpDown} from "@phosphor-icons/react"

import {CAPTION_CLASS, EntryList, type SwitcherEntry} from "./ProjectOrgSwitcher"

export interface ProjectSwitchProps {
    /** The current project's name, the button's text. */
    label: string
    /** The organization's name, for the menu's "Projects in {org}" caption. */
    orgLabel: string
    /** The organization's projects; the active one carries the check. */
    projects: SwitcherEntry[]
    /** Where the menu portals; a drawer passes an element inside its sheet. */
    panelContainer?: HTMLElement | null
    className?: string
}

const FOCUS_RING =
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"

/**
 * The project name as a switch, for a group heading: the name and a CaretUpDown open the sidebar
 * switcher's project panel (its caption and its list). Picking a project is the host's move.
 */
export const ProjectSwitch = ({
    label,
    orgLabel,
    projects,
    panelContainer,
    className,
}: ProjectSwitchProps) => {
    const [open, setOpen] = useState(false)
    const close = useCallback(() => setOpen(false), [])
    return (
        <Popover open={open} onOpenChange={setOpen} modal={false}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-project-switch
                    className={cn(
                        "flex min-w-0 cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 font-[inherit] text-inherit hover:text-foreground",
                        FOCUS_RING,
                        className,
                    )}
                >
                    <span className="truncate">{label}</span>
                    <CaretUpDown size={12} className="shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                container={panelContainer}
                onOpenAutoFocus={(event) => event.preventDefault()}
                side="bottom"
                align="start"
                className="z-[2000] w-[220px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgElevated p-0 shadow-md"
            >
                <div className="flex flex-col p-1">
                    <div className={CAPTION_CLASS}>Projects in {orgLabel}</div>
                    <EntryList entries={projects} close={close} />
                </div>
            </PopoverContent>
        </Popover>
    )
}
