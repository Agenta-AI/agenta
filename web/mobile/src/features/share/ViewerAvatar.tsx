/** The signed-in viewer's initial, so they can see which account opened the link. */
export const ViewerAvatar = ({user}: {user: {username?: string | null; email?: string | null}}) => {
    const name = (user.username || user.email || "?").trim()
    return (
        <span
            title={user.email ?? name}
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium text-foreground uppercase"
        >
            {name.charAt(0)}
        </span>
    )
}
