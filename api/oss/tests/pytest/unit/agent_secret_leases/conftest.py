from pathlib import Path

import oss.src.apis.fastapi
import oss.src.core
import oss.src.dbs.postgres
import oss.src.middlewares
import oss.src.models.db_models  # noqa: F401


ROOT = Path("/tmp/daytona-slice-c-api/api/oss/src")
oss.src.core.__path__.insert(0, str(ROOT / "core"))
oss.src.dbs.postgres.__path__.insert(0, str(ROOT / "dbs/postgres"))
oss.src.middlewares.__path__.insert(0, str(ROOT / "middlewares"))
oss.src.apis.fastapi.__path__.insert(0, str(ROOT / "apis/fastapi"))
