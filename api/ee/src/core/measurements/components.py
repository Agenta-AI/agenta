"""The measurement component key vocabulary.

One key per distinct price. The rate card is keyed by these, so adding one is a rate-card
change, not only a producer change. A key the card does not price contributes nothing.
"""

REQUEST_COUNT = "request_count"
INPUT_TOKENS = "input_tokens"
CACHE_READ_TOKENS = "cache_read_tokens"
CACHE_WRITE_TOKENS = "cache_write_tokens"
OUTPUT_TOKENS = "output_tokens"

# A sandbox interval: its length, and that length times each resource the sandbox had.
# Only the resource-seconds are priced; the plain seconds are there to be read.
SANDBOX_SECONDS = "sandbox_seconds"
VCPU_SECONDS = "vcpu_seconds"
MEMORY_GIB_SECONDS = "memory_gib_seconds"
