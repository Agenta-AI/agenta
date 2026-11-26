from typing import Optional
from uuid import UUID

from ee.src.core.licenses.types import StoredLicense


class LicensesDAOInterface:
    async def read(self) -> Optional[StoredLicense]:
        """The license key added in the app, if any."""
        raise NotImplementedError

    async def replace(
        self,
        *,
        key_id: UUID,
        key: str,
        created_by_id: UUID,
    ) -> StoredLicense:
        """Store `key` as the only license key, in one transaction."""
        raise NotImplementedError
