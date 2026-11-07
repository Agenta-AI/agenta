import {Component, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button} from "@agenta/ui/ui"

const PanelLoadFailed = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(commonCatalog)
    return (
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
            <span>{t("common.thatDidNotWork")}</span>
            <Button onClick={onRetry}>{t("common.tryAgain")}</Button>
        </div>
    )
}

/** Catches a panel whose code failed to load; "Try again" and reopening load it again. */
export class PanelLoadBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
    state = {failed: false}

    static getDerivedStateFromError() {
        return {failed: true}
    }

    render() {
        if (!this.state.failed) return this.props.children
        return <PanelLoadFailed onRetry={() => this.setState({failed: false})} />
    }
}
