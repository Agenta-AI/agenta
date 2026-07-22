import {memo} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import clsx from "clsx"

import {useWorkflowSwitcher, WORKFLOW_SWITCHER_MENU_CLASS} from "../hooks/useWorkflowSwitcher"

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
        selectedKeys,
        setOpen,
        workflowId,
    } = useWorkflowSwitcher()

    return (
        <Dropdown
            trigger={["click"]}
            placement={collapsed ? "bottomLeft" : "bottomRight"}
            destroyOnHidden
            open={open}
            onOpenChange={setOpen}
            styles={{root: {zIndex: 2000, minWidth: 220}}}
            className={clsx({"flex items-center justify-center": collapsed})}
            menu={{
                items: menuItems,
                selectedKeys,
                onClick: handleMenuClick,
                className: WORKFLOW_SWITCHER_MENU_CLASS,
            }}
        >
            <Button
                type="text"
                aria-label="Switch workflow"
                className={clsx(
                    "flex items-center justify-between overflow-hidden transition-[width,height,padding,gap,border-color] duration-300 ease-in-out",
                    // No border when expanded: the header row it sits in is already
                    // framed by the rail's own line, so a box inside a box reads wrong.
                    collapsed ? "!w-8 !h-8 !p-1 gap-0" : "w-full h-full pl-1.5 pr-2 gap-2",
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
            </Button>
        </Dropdown>
    )
})

WorkflowPicker.displayName = "WorkflowPicker"

export default WorkflowPicker
