import type {ReactNode} from "react"

import {SectionLabel} from "./SectionLabel"

/** One ruled group of the template use card, with an optional label. */
export const TemplateUseCardGroup = ({children, label}: {children: ReactNode; label?: string}) => (
    <div className="flex flex-col gap-2.5 border-x-0 border-b border-t-0 border-solid border-border p-4 last:border-b-0">
        {label ? <SectionLabel>{label}</SectionLabel> : null}
        {children}
    </div>
)
