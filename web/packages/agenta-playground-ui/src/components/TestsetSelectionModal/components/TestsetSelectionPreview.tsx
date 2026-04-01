import {ReactNode} from "react"

import {spacingClasses} from "@agenta/ui/styles"
import {Input} from "antd"

export interface TestsetSelectionPreviewProps {
    /** The search term for filtering testcases */
    searchTerm: string
    /** Callback when search term changes */
    onSearchChange: (term: string) => void
    /** Whether to show the search bar */
    showSearch?: boolean
    /** The actual table component or content to render below search */
    children: ReactNode
}

export function TestsetSelectionPreview({
    searchTerm,
    onSearchChange,
    showSearch = true,
    children,
}: TestsetSelectionPreviewProps) {
    return (
        <div
            className={`flex flex-col flex-1 overflow-hidden ${spacingClasses.panel}`}
            style={{minWidth: 0, minHeight: 0}}
        >
            {showSearch && (
                <Input.Search
                    placeholder="Search testcases..."
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="mb-3 flex-shrink-0"
                />
            )}
            {children}
        </div>
    )
}
