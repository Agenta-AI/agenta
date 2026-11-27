/** The Claude token as a view; the panel holds the form, the stack its title, guard and Save. */
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {SubscriptionTokenPanel} from "./SubscriptionTokenPanel"
import type {SubscriptionViewParams} from "./subscriptionViews"

const SubscriptionTokenViewBody = ({params, nav}: ViewProps<SubscriptionViewParams>) => (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3.5">
        <SubscriptionTokenPanel
            params={params}
            onDone={() => void nav.back()}
            onCancel={() => nav.cancel()}
            useTitle={useViewTitle}
            useForm={useViewForm}
            hostSave={() => nav.save()}
        />
    </div>
)

export default SubscriptionTokenViewBody
