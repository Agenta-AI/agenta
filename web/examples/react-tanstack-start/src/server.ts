/**
 * TanStack Start server entry. IMPORTANT: `./instrumentation` MUST be
 * the very first import — it boots the OTel NodeTracerProvider before
 * any AI SDK call runs. There is no Next.js-style auto-register hook;
 * import order in this file is the only seam.
 *
 * Captured as P-TANSTACK-01 (instrumentation-via-import-order) in the
 * pain log: a single import-order regression silently disables tracing
 * with no warning, no error, no diagnostic. The framework relies on a
 * convention that's invisible to any static check.
 *
 * Export shape: the dev plugin + Nitro adapter expect a default export
 * object with a `.fetch(request)` method (web-standard server shape).
 * `createStartHandler(...)` returns a `(req, opts) => Response` function
 * which we wrap into `{fetch}` here.
 */

import "./instrumentation"

import {createStartHandler, defaultStreamHandler} from "@tanstack/react-start/server"

const fetch = createStartHandler({
    handler: defaultStreamHandler,
})

export default {fetch}
