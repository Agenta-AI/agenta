import {memo} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {CaretDown} from "@phosphor-icons/react"
import clsx from "clsx"

import {useWorkflowSwitcher} from "../hooks/useWorkflowSwitcher"

import WorkflowIdentity from "./WorkflowIdentity"

interface WorkflowPickerProps {
    collapsed: boolean
}

const WorkflowPicker = memo(({collapsed}: WorkflowPickerProps) => {
    const {
        displayName,
        handleMenuClick,
        isEvaluator,
        menuItems,
        open,
        selectedKey,
        setOpen,
        workflowId,
    } = useWorkflowSwitcher()

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger
                className={clsx(
                    "flex items-center justify-between overflow-hidden transition-[width,height,padding,gap,border-color] duration-300 ease-in-out",
                    collapsed
                        ? "!w-8 !h-8 !p-1 gap-0"
                        : "w-full pl-2 pr-3 py-3 h-12 gap-2 border border-solid border-gray-200",
                )}
            >
                <WorkflowIdentity
                    workflowId={workflowId}
                    name={displayName}
                    isEvaluator={isEvaluator}
                    showDetails={!collapsed}
                />
                <span
                    className={clsx(
                        "flex shrink-0 items-center overflow-hidden transition-[width,opacity] duration-300 ease-in-out",
                        collapsed ? "w-0 opacity-0" : "w-3.5 opacity-100",
                    )}
                    aria-hidden={collapsed}
                >
                    <CaretDown
                        size={14}
                        className={clsx("transition-transform", open && "rotate-180")}
                    />
                </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align={collapsed ? "start" : "end"}
                className="max-h-80 overflow-y-auto"
                style={{zIndex: 2000, minWidth: 220}}
            >
                <DropdownMenuRadioGroup value={selectedKey ?? ""} onValueChange={handleMenuClick}>
                    {menuItems.map(({entity, isEvaluator: isEval}) => {
                        const label = entity.name ?? entity.slug ?? entity.id
                        return (
                            <DropdownMenuRadioItem key={entity.id} value={entity.id} closeOnClick>
                                <WorkflowIdentity
                                    workflowId={entity.id}
                                    name={label}
                                    isEvaluator={isEval}
                                    selected={entity.id === workflowId}
                                />
                            </DropdownMenuRadioItem>
                        )
                    })}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
})

WorkflowPicker.displayName = "WorkflowPicker"

export default WorkflowPicker
