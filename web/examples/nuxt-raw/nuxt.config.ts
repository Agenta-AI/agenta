/**
 * Nuxt 4 config for the Vue spike.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ This app mirrors `nextjs-app-router-raw` for Vue: AI SDK v6 │
 *   │ streaming chat, raw OpenTelemetry SDK + SimpleSpanProcessor,│
 *   │ Agenta OTLP exporter. Instrumentation wires via a Nitro     │
 *   │ plugin at server/plugins/otel.ts (NOT a Nuxt-level          │
 *   │ instrumentation.ts hook — Nuxt 3/4 doesn't have one).       │
 *   │                                                             │
 *   │ Per-route edge runtime is NOT available in Nitro — runtime  │
 *   │ selection is at the Nitro preset level (Cloudflare, Vercel  │
 *   │ Edge, Deno, etc.) and applies to the whole server, same as  │
 *   │ TanStack Start (P-TANSTACK-02).                             │
 *   └─────────────────────────────────────────────────────────────┘
 */

export default defineNuxtConfig({
    compatibilityDate: "2026-05-11",
    devtools: {enabled: false},
    devServer: {port: 3106},
    // Force the OTel deps to be treated as Node externals (don't bundle them
    // into the SSR/Nitro chunks). Same pattern as Next 15's
    // serverExternalPackages config in our other spike apps.
    nitro: {
        externals: {
            inline: [],
            external: [
                "@opentelemetry/api",
                "@opentelemetry/sdk-trace-base",
                "@opentelemetry/sdk-trace-node",
                "@opentelemetry/exporter-trace-otlp-proto",
                "@opentelemetry/resources",
                "@opentelemetry/semantic-conventions",
            ],
        },
    },
})
