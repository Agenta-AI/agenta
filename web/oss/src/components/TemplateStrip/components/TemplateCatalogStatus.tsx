import {Button, Skeleton} from "antd"

import {useAgentTemplateCatalog} from "../hooks/useAgentTemplateCatalog"

interface TemplateCatalogStatusProps {
    /** Skeleton rows shown while the catalog loads. */
    rows?: number
    className?: string
}

/**
 * What a template list shows in place of its cards while the catalog is not loaded: a skeleton
 * while the read is in flight, and a short message with a Retry when it failed. Never an empty
 * list — that would read as "there are no templates".
 */
const TemplateCatalogStatus = ({rows = 3, className}: TemplateCatalogStatusProps) => {
    const {status, retry} = useAgentTemplateCatalog()

    if (status === "error") {
        return (
            <div
                role="alert"
                className={`flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--ag-colorBorder)] px-4 py-4 text-xs text-[var(--ag-colorTextSecondary)] ${className ?? ""}`}
            >
                <span>Couldn&apos;t load templates.</span>
                <Button size="small" onClick={retry}>
                    Retry
                </Button>
            </div>
        )
    }

    return (
        <div aria-busy className={className}>
            <Skeleton active title={false} paragraph={{rows}} />
        </div>
    )
}

export default TemplateCatalogStatus
