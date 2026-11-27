/** The device sign-in as a view; the panel holds the sign-in, the stack its title and leave. */
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {SubscriptionSignInPanel} from "./SubscriptionSignInPanel"
import type {SubscriptionViewParams} from "./subscriptionViews"

const SubscriptionSignInViewBody = ({params, nav}: ViewProps<SubscriptionViewParams>) => (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3.5">
        <SubscriptionSignInPanel
            params={params}
            onDone={() => void nav.back()}
            onCancel={() => nav.cancel()}
            useTitle={useViewTitle}
        />
    </div>
)

export default SubscriptionSignInViewBody
