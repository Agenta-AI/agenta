# Sandbox meter key naming (locked)

Scheme: `SANDBOX_<RESOURCE>_<UNIT>_SECONDS` — plain resource token + unit token.

| Resource | Unit | Counter key                 | value                        |
|----------|------|-----------------------------|------------------------------|
| CPU      | CORE | `SANDBOX_CPU_CORE_SECONDS`   | `sandbox_cpu_core_seconds`   |
| RAM      | GIBI | `SANDBOX_RAM_GIBI_SECONDS`   | `sandbox_ram_gibi_seconds`   |
| SSD      | GIBI | `SANDBOX_SSD_GIBI_SECONDS`   | `sandbox_ssd_gibi_seconds`   |
| GPU      | CORE | `SANDBOX_GPU_CORE_SECONDS`   | `sandbox_gpu_core_seconds`   |

- Plain hardware resource names (CPU/RAM/SSD/GPU). Unit token: `CORE` =
  per-core-second (compute), `GIBI` = per-GiB-second (SI gibi = 2^30) for
  memory/disk. `SSD` = sandbox disk compute-time (allocated disk x time).
- Storage GAUGE is separate: `Gauge.BYTES` (`bytes`) — persisted
  bytes at rest, distinct from `SANDBOX_SSD_GIBI_SECONDS`.
- Track C per-dimension credit meters mirror the resource+unit tokens
  (`SANDBOX_CPU_CORE_CREDITS`, `SANDBOX_RAM_GIBI_CREDITS`,
  `SANDBOX_SSD_GIBI_CREDITS`, `SANDBOX_GPU_CORE_CREDITS`) + total
  `SANDBOX_CREDITS`.
