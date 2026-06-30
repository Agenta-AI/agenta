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
                    "flex items-center justify-between gap-2",
                    collapsed
                        ? "!w-8 !h-8 !p-1"
                        : "w-full pl-2 pr-3 py-3 h-12 border border-solid border-gray-200",
                )}
            >
                <WorkflowIdentity
                    workflowId={workflowId}
                    name={displayName}
                    isEvaluator={isEvaluator}
                    showDetails={!collapsed}
                />
                {!collapsed && (
                    <CaretDown
                        size={14}
                        className={clsx("transition-transform", open && "rotate-180")}
                    />
                )}
            </Button>
        </Dropdown>
    )
})

WorkflowPicker.displayName = "WorkflowPicker"

export default WorkflowPicker
