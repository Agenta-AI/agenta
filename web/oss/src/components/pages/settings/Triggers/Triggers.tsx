import {TriggerDeliveriesDrawer} from "@agenta/entity-ui/gatewayTrigger"
import {Typography} from "antd"

import GatewaySchedulesSection from "./components/GatewaySchedulesSection"
import GatewaySubscriptionsSection from "./components/GatewaySubscriptionsSection"
import GatewayTriggersSection from "./components/GatewayTriggersSection"

export default function Triggers() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <Typography.Text type="secondary" className="text-xs">
                    Connect an app, then run workflows automatically — when one of its events fires,
                    or on a recurring schedule.
                </Typography.Text>
            </div>
            <GatewayTriggersSection />
            <GatewaySubscriptionsSection />
            <GatewaySchedulesSection />
            {/* One shared deliveries drawer for both subscriptions and schedules
                (both bind the same atom; rendering it once avoids a duplicate). */}
            <TriggerDeliveriesDrawer />
        </div>
    )
}
