import {TriggerDeliveriesDrawer} from "@agenta/entity-ui/gatewayTrigger"

import GatewaySchedulesSection from "./components/GatewaySchedulesSection"
import GatewaySubscriptionsSection from "./components/GatewaySubscriptionsSection"
import GatewayTriggersSection from "./components/GatewayTriggersSection"

export default function Triggers() {
    return (
        <div className="flex flex-col gap-6">
            <GatewayTriggersSection />
            <GatewaySubscriptionsSection />
            <GatewaySchedulesSection />
            {/* One shared deliveries drawer for both subscriptions and schedules
                (both bind the same atom; rendering it once avoids a duplicate). */}
            <TriggerDeliveriesDrawer />
        </div>
    )
}
