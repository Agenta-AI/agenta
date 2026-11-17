/** The role an invite starts with: "member" when the plan offers it, else the first offered role. */
export const getDefaultInviteRole = (offeredRoles: string[]): string | undefined =>
    offeredRoles.includes("member") ? "member" : offeredRoles[0]
