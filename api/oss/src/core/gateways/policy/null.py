"""The default spend admission and usage sink: admit everything, record nothing.

What OSS and an EE deployment with the wallet off run, so their request path behaves as
it did before the wallet existed.
"""

from typing import Dict, Optional

from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayTarget,
    SpendAdmission,
)
from oss.src.core.gateways.policy.interfaces import (
    SpendAdmissionInterface,
    UsageSinkInterface,
)
from oss.src.utils.context import AuthScope


class NullSpendAdmission(SpendAdmissionInterface):
    async def admit(self, *, scope: AuthScope, target: GatewayTarget) -> SpendAdmission:
        return SpendAdmission(allowed=True)


class NullUsageSink(UsageSinkInterface):
    async def record(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
        outcome: GatewayOutcome,
        run_id: Optional[str],
        run_labels: Optional[Dict[str, str]] = None,
    ) -> None:
        return None
