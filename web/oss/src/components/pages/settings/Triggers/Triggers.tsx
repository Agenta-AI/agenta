import {TriggerDeliveriesDrawer} from "@agenta/entity-ui/gatewayTrigger"
import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {TriggerSchedulesSection, TriggerSubscriptionsSection} from "@agenta/settings-ui"

import GatewayTriggersSection from "./components/GatewayTriggersSection"

export default function Triggers() {
    // gap-8: sections are separated by whitespace, never a rule.
    return (
        <div className="flex flex-col">
            <GatewayTriggersSection />
            <TriggerSubscriptionsSection confirm={AlertPopup} />
            <TriggerSchedulesSection confirm={AlertPopup} />
            {/* One shared deliveries drawer for both subscriptions and schedules
                (both bind the same atom; rendering it once avoids a duplicate). */}
            <TriggerDeliveriesDrawer />
        </div>
    )
}
