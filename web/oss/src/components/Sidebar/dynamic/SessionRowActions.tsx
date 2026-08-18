import {memo, useCallback, useMemo, useState, type ReactNode} from "react"

import {DotsThreeVertical} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"

import {
    useSessionActions,
    type SessionActionTarget,
} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"

import type {SessionSidebarRef} from "./sessionsSource"

const CONTEXT_TRIGGER: ("contextMenu" | "hover" | "click")[] = ["contextMenu"]
const CLICK_TRIGGER: ("contextMenu" | "hover" | "click")[] = ["click"]
const KEBAB_ICON = <DotsThreeVertical size={14} />

/**
 * Per-row session actions for the sidebar — the same verbs the playground's session bar offers,
 * from the same `useSessionActions` set, so the two surfaces cannot drift apart.
 *
 * Wraps the row's label: right-click anywhere on it, or use the kebab that appears on hover. The
 * kebab's 20px slot is always reserved so revealing it never reflows the label, but the button
 * itself mounts only while hot (each one carries a Dropdown + Button subtree, times every row).
 */
const SessionRowActions = ({
    session,
    children,
}: {
    session: SessionSidebarRef
    children: ReactNode
}) => {
    const {menuItems, onMenuClick} = useSessionActions()
    const [hot, setHot] = useState(false)
    const [open, setOpen] = useState(false)

    const target = useMemo(
        (): SessionActionTarget => ({
            sessionId: session.sessionId,
            appId: session.appId,
            name: session.name ?? null,
            // The sidebar list requests `includeArchived: false`, so a row here is never archived.
            archived: false,
        }),
        [session.sessionId, session.appId, session.name],
    )
    const menu = useMemo(
        () => ({items: menuItems(target), onClick: onMenuClick(target)}),
        [menuItems, onMenuClick, target],
    )

    const onEnter = useCallback(() => setHot(true), [])
    const onLeave = useCallback((e: React.MouseEvent<HTMLElement>) => {
        // Don't unmount the kebab out from under keyboard focus.
        if (!e.currentTarget.contains(document.activeElement)) setHot(false)
    }, [])
    const onBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(false)
    }, [])
    // The row's link stretches a ::before over the whole item — swallow the kebab's click so
    // opening the menu doesn't also navigate into the session.
    const swallow = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    return (
        <Dropdown menu={menu} trigger={CONTEXT_TRIGGER}>
            <span
                className="flex w-full min-w-0 items-center"
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                onFocus={onEnter}
                onBlur={onBlur}
            >
                <span className="min-w-0 flex-1 truncate">{children}</span>
                <span
                    className="relative z-[1] flex h-5 w-5 shrink-0 items-center justify-center"
                    onClick={swallow}
                >
                    {(hot || open) && (
                        <Dropdown
                            menu={menu}
                            trigger={CLICK_TRIGGER}
                            open={open}
                            onOpenChange={setOpen}
                        >
                            <Button
                                type="text"
                                size="small"
                                aria-label={`Actions for ${session.name || "Untitled session"}`}
                                icon={KEBAB_ICON}
                                className="!h-5 !w-5 !min-w-0 !p-0"
                            />
                        </Dropdown>
                    )}
                </span>
            </span>
        </Dropdown>
    )
}

export default memo(SessionRowActions)
