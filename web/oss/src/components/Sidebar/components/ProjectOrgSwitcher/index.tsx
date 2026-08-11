import {memo, useCallback, useMemo, useState} from "react"

import {InitialsAvatar} from "@agenta/ui"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {
    ArrowLeft,
    ArrowsLeftRight,
    CaretRight,
    CaretUpDown,
    Check,
    Desktop,
    GearSix,
    Moon,
    Plus,
    SignOut,
    Sun,
    X,
} from "@phosphor-icons/react"
import {Dropdown, Form, Input, Popover} from "antd"
import clsx from "clsx"

import {THEME_OPTIONS} from "@/oss/components/Layout/assets/themeOptions"
import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

import {useProjectOrgSwitcher} from "../../hooks/useProjectOrgSwitcher"

interface ProjectOrgSwitcherProps {
    collapsed: boolean
}

type Panel = "projects" | "orgs"

const ROW_CLASS =
    "flex w-full items-center gap-2 h-8 px-2 rounded-md text-sm leading-none text-left cursor-pointer border-0 bg-transparent [font:inherit] text-[var(--ag-colorText)] hover:bg-[var(--ag-colorFillTertiary)] transition-colors"

/** shrink-0 stops the capped scroll list from compressing rows instead of scrolling. */
const ITEM_ROW_CLASS = "shrink-0"

const CAPTION_CLASS =
    "px-2 pt-1.5 pb-1 text-xs font-medium text-[var(--ag-colorTextTertiary)] truncate"

/** Capped scroll list (3 h-8 rows) with the scrollbar hidden. */
const SCROLL_LIST_CLASS =
    "flex max-h-24 flex-col overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"

const Row = ({
    onClick,
    className,
    children,
    title,
}: {
    onClick?: () => void
    className?: string
    children: React.ReactNode
    title?: string
}) => (
    <button type="button" onClick={onClick} className={clsx(ROW_CLASS, className)} title={title}>
        {children}
    </button>
)

const themeIcon = (mode: ThemeMode) => {
    switch (mode) {
        case ThemeMode.Dark:
            return <Moon size={14} className="shrink-0" />
        case ThemeMode.System:
            return <Desktop size={14} className="shrink-0" />
        default:
            return <Sun size={14} className="shrink-0" />
    }
}

/** Theme switcher as a hover fly-out row for the switcher menu (see also the Preferences tab). */
const ThemeFlyout = () => {
    const {themeMode, toggleAppTheme} = useAppTheme()
    const current = THEME_OPTIONS.find(({mode}) => mode === themeMode) ?? THEME_OPTIONS[0]

    return (
        <Popover
            // "click" alongside "hover" keeps the fly-out reachable by keyboard: the trigger
            // library only wires focus handling when "focus" is in the action set, so a
            // hover-only trigger left Enter/Space on the button inert.
            trigger={["hover", "click"]}
            placement="rightBottom"
            arrow={false}
            styles={{
                root: {zIndex: 2001},
                container: {padding: 0, background: "transparent", boxShadow: "none"},
            }}
            content={
                <div className="w-[190px] overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgElevated)] p-1 shadow-md">
                    {THEME_OPTIONS.map(({mode, label}) => (
                        <Row
                            key={mode}
                            className={ITEM_ROW_CLASS}
                            onClick={() => toggleAppTheme(mode)}
                        >
                            {themeIcon(mode)}
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            {themeMode === mode && (
                                <Check size={14} className="shrink-0 text-[var(--ag-colorText)]" />
                            )}
                        </Row>
                    ))}
                </div>
            }
        >
            <button type="button" className={ROW_CLASS}>
                {themeIcon(themeMode)}
                <span className="flex-1">Theme</span>
                <span className="text-[12px] text-[var(--ag-colorTextSecondary)]">
                    {current.short}
                </span>
                <CaretRight size={14} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
            </button>
        </Popover>
    )
}

const MenuDivider = () => <div className="my-1 h-px bg-[var(--ag-colorBorderSecondary)]" />

/** Shared bottom section for both switcher panels: theme fly-out + logout. */
const SwitcherFooter = ({onLogout}: {onLogout: () => void}) => (
    <>
        <MenuDivider />
        <ThemeFlyout />
        <Row className="!text-[var(--ag-colorError)]" onClick={onLogout}>
            <SignOut size={14} className="shrink-0" />
            <span className="flex-1">Logout</span>
        </Row>
    </>
)

const ProjectOrgSwitcher = ({collapsed}: ProjectOrgSwitcherProps) => {
    const {
        currentOrg,
        currentProject,
        orgOptions,
        projectsForOrg,
        switchProject,
        switchOrg,
        goToOrgSettings,
        confirmLogout,
        createProject,
        createOrg,
    } = useProjectOrgSwitcher()

    const [open, setOpen] = useState(false)
    const [panel, setPanel] = useState<Panel>("projects")

    const projectLabel = currentProject?.project_name || "Select project"
    const orgLabel = currentOrg?.name || "Organization"

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next)
        if (!next) setPanel("projects")
    }, [])

    const close = useCallback(() => {
        setOpen(false)
        setPanel("projects")
    }, [])

    const handleLogout = useCallback(() => {
        close()
        confirmLogout()
    }, [close, confirmLogout])

    const projectPanel = useMemo(
        () => (
            <div className="flex flex-col p-1">
                <div className={CAPTION_CLASS}>Projects in {orgLabel}</div>
                <div className={SCROLL_LIST_CLASS}>
                    {projectsForOrg.map((proj) => {
                        const isActive =
                            proj.project_id === currentProject?.project_id &&
                            proj.workspace_id === currentProject?.workspace_id
                        return (
                            <Row
                                key={`${proj.workspace_id}:${proj.project_id}`}
                                className={clsx(
                                    ITEM_ROW_CLASS,
                                    isActive && "bg-[var(--ag-colorFillSecondary)]",
                                )}
                                onClick={() => {
                                    close()
                                    if (!isActive) switchProject(proj)
                                }}
                            >
                                <InitialsAvatar size="small" name={proj.project_name} />
                                <span className="min-w-0 flex-1 truncate">{proj.project_name}</span>
                                {isActive && (
                                    <Check
                                        size={14}
                                        className="shrink-0 text-[var(--ag-colorText)]"
                                    />
                                )}
                            </Row>
                        )
                    })}
                </div>
                <MenuDivider />
                <Row onClick={() => setPanel("orgs")}>
                    <ArrowsLeftRight size={14} className="shrink-0" />
                    <span className="flex-1">Switch organization</span>
                </Row>
                <Row
                    className="font-medium text-[var(--ag-colorPrimary)]"
                    onClick={() => {
                        close()
                        createProject.setOpen(true)
                    }}
                >
                    <Plus size={14} className="shrink-0" />
                    <span className="flex-1">New project</span>
                </Row>
                <SwitcherFooter onLogout={handleLogout} />
            </div>
        ),
        [
            close,
            createProject,
            currentProject?.project_id,
            currentProject?.workspace_id,
            handleLogout,
            orgLabel,
            projectsForOrg,
            switchProject,
        ],
    )

    const orgPanel = useMemo(
        () => (
            <div className="flex flex-col p-1">
                <div className="flex items-center justify-between">
                    <Row
                        className="!w-auto flex-1 font-medium"
                        onClick={() => setPanel("projects")}
                    >
                        <ArrowLeft size={14} className="shrink-0" />
                        <span>Projects</span>
                    </Row>
                    <button
                        type="button"
                        aria-label="Close"
                        title="Close"
                        onClick={close}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent cursor-pointer text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillTertiary)]"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className={CAPTION_CLASS}>Organizations</div>
                <div className={SCROLL_LIST_CLASS}>
                    {orgOptions.map((org) => {
                        const isActive = org.id === currentOrg?.id
                        return (
                            <Row
                                key={org.id}
                                className={clsx(
                                    ITEM_ROW_CLASS,
                                    isActive && "bg-[var(--ag-colorFillSecondary)]",
                                )}
                                onClick={() => {
                                    close()
                                    if (!isActive) void switchOrg(org.id)
                                }}
                            >
                                <InitialsAvatar size="small" name={org.name} />
                                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                                {isActive && (
                                    <Check
                                        size={14}
                                        className="shrink-0 text-[var(--ag-colorText)]"
                                    />
                                )}
                            </Row>
                        )
                    })}
                </div>
                <MenuDivider />
                <Row
                    className="font-medium text-[var(--ag-colorPrimary)]"
                    onClick={() => {
                        close()
                        createOrg.setOpen(true)
                    }}
                >
                    <Plus size={14} className="shrink-0" />
                    <span className="flex-1">Create organization</span>
                </Row>
                <Row
                    onClick={() => {
                        close()
                        goToOrgSettings()
                    }}
                >
                    <GearSix size={14} className="shrink-0" />
                    <span className="flex-1">Organization settings</span>
                </Row>
                <SwitcherFooter onLogout={handleLogout} />
            </div>
        ),
        [close, createOrg, currentOrg?.id, goToOrgSettings, handleLogout, orgOptions, switchOrg],
    )

    return (
        <div className={clsx("px-2 py-2", collapsed && "flex justify-center")}>
            <Dropdown
                trigger={["click"]}
                open={open}
                onOpenChange={handleOpenChange}
                // Docked at the rail's bottom-left edge: open upward, left-aligned, so a
                // 240px panel never clips against the viewport's left edge.
                placement="topLeft"
                destroyOnHidden
                styles={{root: {zIndex: 2000}}}
                popupRender={() => (
                    // Fixed width matching the expanded trigger (sidebar 236px − 14px wrapper padding).
                    <div className="w-[220px] overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgElevated)] shadow-md">
                        {panel === "projects" ? projectPanel : orgPanel}
                    </div>
                )}
            >
                <button
                    type="button"
                    data-project-org-switcher
                    className={clsx(
                        // Borderless at rest; the hover fill is the affordance.
                        "flex items-center rounded-md border-0 bg-transparent cursor-pointer transition-colors hover:bg-[var(--ag-colorFillTertiary)]",
                        collapsed ? "h-8 w-8 justify-center p-1" : "w-full gap-2 px-1.5 py-1.5",
                    )}
                    title={`${projectLabel} · ${orgLabel}`}
                >
                    <InitialsAvatar size="small" name={projectLabel} />
                    {!collapsed && (
                        <>
                            <div className="flex min-w-0 flex-1 flex-col text-left">
                                <span className="truncate text-sm font-medium leading-tight text-[var(--ag-colorText)]">
                                    {projectLabel}
                                </span>
                                <span className="truncate text-xs leading-tight text-[var(--ag-colorTextSecondary)]">
                                    {orgLabel}
                                </span>
                            </div>
                            <CaretUpDown
                                size={14}
                                className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                            />
                        </>
                    )}
                </button>
            </Dropdown>

            <EnhancedModal
                title="Create project"
                open={createProject.open}
                okText="Create"
                onCancel={() => {
                    createProject.setOpen(false)
                    createProject.form.resetFields()
                }}
                onOk={() => createProject.form.submit()}
                confirmLoading={createProject.isPending}
                destroyOnHidden
                centered
            >
                <Form
                    form={createProject.form}
                    layout="vertical"
                    onFinish={(values) => createProject.submit(values)}
                >
                    <Form.Item
                        label="Project name"
                        name="name"
                        rules={[{required: true, message: "Please enter a project name"}]}
                    >
                        <Input placeholder="Project name" autoFocus />
                    </Form.Item>
                </Form>
            </EnhancedModal>

            <EnhancedModal
                title="Create organization"
                open={createOrg.open}
                okText="Create"
                onCancel={() => {
                    createOrg.setOpen(false)
                    createOrg.form.resetFields()
                }}
                onOk={() => createOrg.form.submit()}
                confirmLoading={createOrg.isPending}
                destroyOnHidden
                centered
            >
                <Form
                    form={createOrg.form}
                    layout="vertical"
                    onFinish={(values) => createOrg.submit(values)}
                >
                    <Form.Item
                        label="Name"
                        name="name"
                        rules={[{required: true, message: "Please enter an organization name"}]}
                    >
                        <Input placeholder="Organization name" autoFocus />
                    </Form.Item>
                </Form>
            </EnhancedModal>
        </div>
    )
}

export default memo(ProjectOrgSwitcher)
