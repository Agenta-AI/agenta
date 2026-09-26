import {Button} from "@agenta/ui/ui"

export const WalletUsageError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex flex-col items-start gap-3 p-6">
        <p className="m-0 text-sm">Could not load the wallet data.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
        </Button>
    </div>
)
