import {TriggerDeliveriesDrawer} from "@agenta/entity-ui/gatewayTrigger"

import GatewaySchedulesSection from "./components/GatewaySchedulesSection"
import GatewaySubscriptionsSection from "./components/GatewaySubscriptionsSection"
import GatewayTriggersSection from "./components/GatewayTriggersSection"

export default function Triggers() {
    // gap-8: sections are separated by whitespace, never a rule.
    return (
        <div className="flex flex-col">
            <GatewayTriggersSection />
            <GatewaySubscriptionsSection />
            <GatewaySchedulesSection />
            {/* One shared deliveries drawer for both subscriptions and schedules
                (both bind the same atom; rendering it once avoids a duplicate). */}
            <TriggerDeliveriesDrawer />
        </div>
    )
}
