# Sandbox meter key naming (locked)

Scheme: `SANDBOX_<RESOURCE>_SECONDS` — plain 3-letter resource tokens.

| Resource | Counter key             | value                    |
|----------|-------------------------|--------------------------|
| CPU      | `SANDBOX_CPU_SECONDS`   | `sandbox_cpu_seconds`    |
| RAM      | `SANDBOX_RAM_SECONDS`   | `sandbox_ram_seconds`    |
| SSD      | `SANDBOX_SSD_SECONDS`   | `sandbox_ssd_seconds`    |
| GPU      | `SANDBOX_GPU_SECONDS`   | `sandbox_gpu_seconds`    |

- Plain hardware names (no `v`/virtual prefix, no unit token) — chosen for
  readability. `SSD` = sandbox disk compute-time (allocated disk x time).
- Storage GAUGE is separate: `Gauge.STORAGE_BYTES` (`storage_bytes`) — persisted
  bytes at rest, distinct from `SANDBOX_SSD_SECONDS`.
- Track C per-dimension credit meters mirror the resource tokens
  (`SANDBOX_CPU_CREDITS`, `SANDBOX_RAM_CREDITS`, `SANDBOX_SSD_CREDITS`,
  `SANDBOX_GPU_CREDITS`) + total `SANDBOX_CREDITS`.
