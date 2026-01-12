# Algorithms: TBRA vs GCRA

Two algorithms are supported, both using the same interface: `max_capacity` and `refill_rate`.

---

## TBRA (Token Bucket Rate Algorithm)

### Intuition

Token bucket models rate as:
- A bucket has **capacity** (max tokens) that caps burst
- Tokens **refill continuously** at `refill_rate` per minute
- Each request **consumes 1 token**
- If insufficient tokens → request denied until tokens refill

**Key property**: Tokens can be "banked" while idle. A quiet principal can later spend a burst up to the bucket capacity.

### Parameters

| Parameter | Description |
|-----------|-------------|
| `max_capacity` | Burst size (max tokens) |
| `refill_rate` | Tokens per minute |

### State in Redis

```
"tokens_scaled|last_step"
```

- `tokens_scaled`: Current tokens × 1000 (fixed-point)
- `last_step`: Last update time in steps

### Algorithm

```
on request at now_step:
  elapsed = now_step - last_step
  tokens = tokens + elapsed * refill_per_step
  tokens = min(max_capacity, tokens)

  tokens = tokens - 1
  if tokens >= 0:
    allowed = true
    retry_after = 0
  else:
    allowed = false
    retry_after = ceil(-tokens / refill_per_step)

  store(tokens, now_step)
  return (allowed, tokens, retry_after)
```

### What You Get

- Very intuitive semantics ("banked burst")
- Meaningful "remaining tokens" for headers
- Tokens accumulate when idle

### What You Lose

- Slightly more CPU (parsing, refill math)
- State is slightly larger (two values)

---

## GCRA (Generic Cell Rate Algorithm)

### Intuition

GCRA is a leaky bucket / scheduling approach:
- Enforces average **spacing between requests**
- Allows bursts via **tolerance** (how early a request can be)
- Stores only one value: **TAT** (Theoretical Arrival Time)

**Key property**: Very smooth, predictable enforcement with minimal state.

### Parameters

| Parameter | Description |
|-----------|-------------|
| `max_capacity` | Burst tolerance (in requests) |
| `refill_rate` | Requests per minute |

Derived:
- `interval = 60000 / (refill_rate * TIME_STEP_MS)` — steps between requests
- `tolerance = max_capacity * interval` — burst tolerance in steps

### State in Redis

```
"tat"
```

- `tat`: Theoretical arrival time (single integer)

### Algorithm

```
on request at now_step:
  tat = get(key) or now_step
  limit = tat - tolerance

  if now_step < limit:
    allowed = false
    retry_after = limit - now_step
    new_tat = tat
  else:
    allowed = true
    retry_after = 0
    new_tat = max(tat, now_step) + interval

  store(new_tat)
  return (allowed, retry_after)
```

### What You Get

- Extremely fast (one integer state)
- Smooth, predictable behavior
- Very stable under high load
- Clear retry-after calculation

### What You Lose

- No explicit "banked tokens" concept
- Burst is tolerance, not stored tokens
- No "remaining tokens" value (always None)

---

## Comparison

| Property | TBRA | GCRA |
|----------|------|------|
| State size | 2 values (tokens + ts) | 1 value (tat) |
| CPU | Slightly more (refill math) | Minimal |
| "Remaining tokens" | Yes (natural) | No |
| Burst semantics | Banked tokens | Tolerance window |
| After idle period | Full bucket available | Tolerance available |
| Headers UX | `X-RateLimit-Remaining` works | Only `Retry-After` |

### Semantics Difference

**TBRA**: If idle for 10 minutes with 60 tokens/min refill and capacity 100:
- Bucket fills to 100 tokens
- Can make 100 requests immediately

**GCRA**: Same parameters, idle for 10 minutes:
- Can make up to `max_capacity` requests with tolerance
- Then must respect spacing interval

In most real workloads, these feel identical. The difference shows in long-idle-then-burst patterns.

---

## Best Fit Guidance

**Choose TBRA if**:
- "Banked burst after idle" is a product expectation
- You want strong "remaining tokens" UX
- Clients expect `X-RateLimit-Remaining` header

**Choose GCRA if**:
- Maximum throughput and simplest implementation
- Smooth scheduling and predictable retry-after
- Burst semantics as tolerance is acceptable

**Pragmatic strategy**:
- Use GCRA everywhere by default (fast, smooth)
- Reserve TBRA for places where "banked burst" is a deliberate customer promise

---

## Performance Optimizations

Both algorithms use these optimizations:

### Time Quantization

Use 1-second steps instead of milliseconds:
```python
TIME_STEP_MS = 1000
now_step = int(time.time() * 1000) // TIME_STEP_MS
```

Effect: Refill happens in chunks, not perfectly continuous. Acceptable for most use cases.

### Fixed-Point Arithmetic

Store tokens as integers scaled by 1000:
```python
_SCALE = 1000
tokens_scaled = capacity * _SCALE
```

Effect: Faster math, no floating-point drift.

### App-Provided Time

Pass `now` from the API instead of calling Redis `TIME`:
```python
now_step = _now_step()  # computed in Python
```

Effect: Removes one Redis call. Small clock skew is acceptable for enforcement.

### Hardcoded TTL

TTL is hardcoded in the script (60 minutes):
```lua
redis.call('SET', key, value, 'PX', 3600000)
```

Effect: One less parameter to pass.

---

## Script Contracts

### TBRA Script

**Inputs**:
- `KEYS[1]`: bucket key
- `ARGV[1]`: max_cap_scaled
- `ARGV[2]`: refill_per_step_scaled
- `ARGV[3]`: now_step

**Outputs**:
- `[0]`: allowed (0 or 1)
- `[1]`: tokens_scaled (current tokens × 1000)
- `[2]`: retry_steps (steps until allowed)

### GCRA Script

**Inputs**:
- `KEYS[1]`: bucket key
- `ARGV[1]`: interval (steps between requests)
- `ARGV[2]`: tolerance (burst tolerance in steps)
- `ARGV[3]`: now_step

**Outputs**:
- `[0]`: allowed (0 or 1)
- `[1]`: retry_steps (steps until allowed)
