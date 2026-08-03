/**
 * CatalogUnavailableNotice — "the schema asked for the harness catalog and we couldn't fetch it".
 *
 * Replaces antd `Alert action={<Button>Retry</Button>}`. The `@agenta/ui` Alert deliberately does
 * not implement `action` (see antd-inventory/migrations/Alert.md), so the Retry button is composed
 * into the description row instead of sitting in antd's trailing action slot — a declared
 * divergence (the button lands one line lower, right-aligned).
 */
import {Alert, Button} from "@agenta/ui/ui"

export function CatalogUnavailableNotice({onRetry}: {onRetry: () => void}) {
    return (
        <Alert
            type="warning"
            showIcon
            message="Couldn't load the model catalog"
            description={
                <div className="flex items-start justify-between gap-4">
                    <span>
                        The harness and model options come from the server. Until it responds, only
                        the basic controls are available.
                    </span>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
                        Retry
                    </Button>
                </div>
            }
        />
    )
}

export default CatalogUnavailableNotice
