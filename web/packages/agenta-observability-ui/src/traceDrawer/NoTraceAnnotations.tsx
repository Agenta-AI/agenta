import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"

/** antd `Typography.Text type="secondary"` → a plain span on the secondary text token. */
const NoTraceAnnotations = () => {
    const t = useT(drawerCatalog)
    return (
        <div className="flex items-center justify-center">
            <span className="text-colorTextSecondary">
                {t("observabilityUi.traceDrawer.noAnnotationsForTrace")}
            </span>
        </div>
    )
}

export default NoTraceAnnotations
