from oss.src.core.notifications.dtos import (
    NotificationState,
    PendingNotificationDelivery,
)
from oss.src.dbs.postgres.notifications.dbes import (
    NotificationDBE,
    NotificationDeliveryDBE,
)


def map_pending_delivery(
    *,
    delivery_dbe: NotificationDeliveryDBE,
    notification_dbe: NotificationDBE,
) -> PendingNotificationDelivery:
    return PendingNotificationDelivery(
        project_id=delivery_dbe.project_id,
        id=delivery_dbe.id,
        notification_id=delivery_dbe.notification_id,
        user_id=delivery_dbe.user_id,
        notification_state=NotificationState(notification_dbe.state),
        data=notification_dbe.data,
    )
