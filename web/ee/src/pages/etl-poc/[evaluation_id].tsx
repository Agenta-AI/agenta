/**
 * EE re-export of the OSS ETL PoC test page.
 *
 * EE's Next.js app uses filesystem routing over `web/ee/src/pages/` and
 * does NOT auto-inherit OSS pages — each route needs an explicit
 * re-export file. Without this, /etl-poc/<runId> 404s on EE web.
 *
 * The page itself lives in `@agenta/oss/src/pages/etl-poc/[evaluation_id]`
 * and has no EE-specific behaviour, so this is a plain pass-through.
 */

import EtlPocPage from "@agenta/oss/src/pages/etl-poc/[evaluation_id]"

export default EtlPocPage
