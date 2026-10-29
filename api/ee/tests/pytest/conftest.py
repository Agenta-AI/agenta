import os

# litellm fetches its model price map from GitHub at import time unless this is set, so a change
# upstream (a dropped model, a new price) changes test results without any change here. Pin the
# map bundled with the locked litellm. It must be set before anything imports litellm. Export
# LITELLM_LOCAL_MODEL_COST_MAP=False to test against the live map on purpose.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import sys
from pathlib import Path

# Reuse the OSS test utilities (fixtures, helpers) from oss/tests/pytest.
_OSS_TEST_ROOT = Path(__file__).resolve().parents[3] / "oss" / "tests" / "pytest"
if str(_OSS_TEST_ROOT) not in sys.path:
    sys.path.insert(0, str(_OSS_TEST_ROOT))

from utils.env import ag_env  # noqa: E402,F401
from utils.egress import secure_egress_by_default  # noqa: E402,F401
from utils.api import (  # noqa: E402,F401
    admin_api,
    authed_api,
    unauthed_api,
)
from utils.accounts import (  # noqa: E402,F401
    foo_account,
    cls_account,
    mod_account,
)
