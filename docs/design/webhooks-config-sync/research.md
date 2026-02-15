# Webhook Implementation Research

## 1. Industry Best Practices

### Stripe Webhooks

**Signature Verification**:
- Header: `Stripe-Signature`
- Format: `t=<timestamp>,v1=<signature>`
- Uses HMAC-SHA256 with endpoint secret
- Timestamp prevents replay attacks

**Delivery**:
- 10-second timeout
- Automatic retries with exponential backoff (up to 3 days)
- Idempotency via `X-GitHub-Delivery` (event ID)

**Best Practices from Stripe**:
1. Return 2xx quickly, process async
2. Handle duplicate events (idempotency)
3. Verify signatures BEFORE processing
4. Only subscribe to needed events

### GitHub Webhooks

**Key Headers**:
- `X-GitHub-Event`: Event type
- `X-GitHub-Delivery`: Unique delivery ID (for idempotency)
- `X-Hub-Signature-256`: HMAC-SHA256 signature

**Best Practices**:
1. Respond within 10 seconds
2. Use async processing (queue payloads)
3. Redeliver missed deliveries manually
4. Check event type AND action before processing

**Retry Policy**:
- GitHub allows manual redelivery
- No automatic retries (by design)

### Common Patterns Summary

| Feature | Stripe | GitHub |
|---------|--------|--------|
| Signature | HMAC-SHA256 | HMAC-SHA256 |
| Signature Header | `Stripe-Signature` | `X-Hub-Signature-256` |
| Timestamp in Signature | Yes | No |
| Delivery ID | Yes | `X-GitHub-Delivery` |
| Auto Retries | Yes (exponential) | No |
| Timeout | 10s | 10s |

Other platforms in the LLM tooling space follow similar patterns. HMAC-SHA256 with timestamps is the de facto standard for webhook security.

---

## 2. Build vs Buy Analysis

### Option: Use Svix (Webhook-as-a-Service)

**Pros**:
- Handles retries, monitoring, security automatically
- Embeddable consumer portal
- SOC 2 Type II, HIPAA compliant
- Used by Brex, Clerk, Replicate

**Cons**:
- Additional dependency and cost
- May be overkill for MVP
- Adds external service to infrastructure

**Pricing**: Free tier available, scales with usage

### Option: Build from Scratch

**Pros**:
- Full control
- No external dependencies
- Simpler for MVP scope
- Can add Svix later if needed

**Cons**:
- Must implement retries, monitoring, etc.
- More maintenance burden long-term

### Recommendation
**Start with build-from-scratch for MVP**, then evaluate Svix if:
- Webhook volume grows significantly
- Need advanced features (consumer portal, detailed analytics)
- Want to offload maintenance

---

## 3. Alternatives to Webhooks

### Polling Endpoint
```
GET /api/configs/changes?since=2024-01-15T10:00:00Z
```

**Pros**: Simple, no infrastructure
**Cons**: Latency, wasted requests, not real-time

### Server-Sent Events (SSE)
**Pros**: Real-time, simpler than WebSockets
**Cons**: Connection management, not great for server-to-server

### Native GitHub App
Instead of generic webhook → custom receiver → GitHub, build a native GitHub App integration.

**Pros**: Better UX, no intermediate server needed
**Cons**: GitHub-specific, more complex to build

### Recommendation
**Webhooks are the right choice** because:
1. Standard pattern that users expect
2. Works for any integration (not just GitHub)
3. Multiple LLM platforms already offer similar functionality, validating the use case

---

## 4. Security Considerations

### HMAC Signature Verification (Required)
```python
import hmac
import hashlib

def verify_webhook(payload: str, signature_header: str, secret: str) -> bool:
    # Parse "t=<timestamp>,s=<signature>"
    parts = dict(p.split("=") for p in signature_header.split(","))
    timestamp = parts["t"]
    received_sig = parts["s"]
    
    # Compute expected signature
    message = f"{timestamp}.{payload}"
    expected_sig = hmac.new(
        secret.encode(), 
        message.encode(), 
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(received_sig, expected_sig)
```

### Additional Security Measures
1. **Timestamp validation**: Reject if timestamp > 5 minutes old (replay protection)
2. **HTTPS only**: Reject HTTP endpoints in production
3. **Secret rotation**: Allow regenerating signing secrets
4. **IP allowlist**: Optional feature for enterprise

### Common Attack Vectors
| Attack | Mitigation |
|--------|------------|
| Replay attacks | Timestamp in signature |
| SSRF | Validate URLs, no internal IPs |
| Spoofing | HMAC signature verification |
| Denial of service | Rate limiting on sends |
