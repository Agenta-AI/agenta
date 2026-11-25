import {memo, type ReactNode} from "react"

/** The help line under a skill field label. Memoized: its text never changes while someone types. */
export const SkillHint = memo(function SkillHint({children}: {children: ReactNode}) {
    return <p className="m-0 text-meta text-muted-foreground">{children}</p>
})
