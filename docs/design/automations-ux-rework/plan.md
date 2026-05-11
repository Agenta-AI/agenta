# Execution Plan

## Checkpoint 1: Remove the gate, auto-ping on save, restore test button

**Goal:** Subscriptions are always active. Create/edit sends a diagnostic ping. Test button available in the drawer after save.

### 1.1 Backend: Remove `is_valid` gating from dispatcher

**File:** `api/oss/src/tasks/asyncio/webhooks/dispatcher.py`

The dispatcher currently requires `is_valid=True` for real events (lines ~223-233). Change the matching logic so all subscriptions receive events regardless of `is_valid`:

```python
# BEFORE (lines 223-233):
else:
    matching = [
        sub for sub in subscriptions
        if sub.flags is not None
        and sub.flags.is_valid
        and (
            sub.data.event_types is None
            or event_type in sub.data.event_types
        )
    ]

# AFTER:
else:
    matching = [
        sub for sub in subscriptions
        if (
            sub.data.event_types is None
            or event_type in sub.data.event_types
        )
    ]
```

The `is_valid` flag remains in the data model but becomes informational (reflects "last test succeeded"), not a gate.

### 1.2 Backend: Stop forcing `is_valid=False` on create/edit

**File:** `api/oss/src/core/webhooks/service.py`

**In `create_subscription` (~lines 146-148):** Remove the forced flag override. The subscription will get whatever default the model provides (`is_valid=False` from the DTO default). Since the dispatcher no longer gates on it, this is purely a display concern. We keep it as `False` on create -- the auto-ping or manual test will flip it to `True`.

```python
# REMOVE these lines from create_subscription:
subscription.flags = WebhookSubscriptionFlags(
    is_valid=False,
)
```

No replacement needed. The DTO default (`is_valid=False`) is fine -- it means "not yet tested."

**In `edit_subscription` (~lines 242-244):** Same removal. The edit should preserve the existing `is_valid` value. 

```python
# REMOVE these lines from edit_subscription:
subscription.flags = WebhookSubscriptionFlags(
    is_valid=False,
)
```

**Also in `edit_subscription`:** Restore the flag preservation in mappings. The current branch removed this from `mappings.py`:

**File:** `api/oss/src/dbs/postgres/webhooks/mappings.py`

```python
# ADD BACK in map_subscription_dto_to_dbe_edit, after merged_flags computation:
if "is_valid" in existing_flags:
    merged_flags["is_valid"] = existing_flags["is_valid"]
```

This ensures edits (name, events, etc.) don't reset `is_valid`. The flag only changes via `enable_subscription` (test success) or a future explicit action.

### 1.3 Frontend-driven ping after create/edit

**File:** `web/oss/src/components/Automations/AutomationDrawer.tsx`

Use the existing `testWebhookSubscription` endpoint immediately after a successful create or update. This avoids adding backend auto-ping machinery in iteration 1 and gives the user immediate toast feedback from the existing polling endpoint.

Flow:

1. Save the subscription
2. Capture the saved `subscriptionId`
3. Close the drawer and keep the saved automation active
4. Call `testAutomation(subscriptionId)`
5. Show `handleTestResult(response)` on success, or a non-fatal warning if the test request itself fails

### 1.4 Frontend: Restore test button in drawer

**File:** `web/oss/src/components/Automations/AutomationDrawer.tsx`

Re-add the test button to the drawer footer. It should:
- Only be enabled when editing an existing subscription (`isEdit && initialValues?.id`)
- Show loading state while testing
- Display result via `handleTestResult`

```tsx
// In the footer:
<div className="flex items-center justify-between gap-2">
    <Button onClick={onCancel}>Cancel</Button>
    <div className="flex items-center gap-2">
        <Button
            loading={isTesting}
            onClick={handleTestConnection}
            disabled={!isEdit || isTesting}
        >
            Test Connection
        </Button>
        <Button type="primary" onClick={handleOk} loading={isSubmitting}>
            {isEdit ? "Update Automation" : "Create Automation"}
        </Button>
    </div>
</div>
```

Re-add the `handleTestConnection` callback and `testAutomationAtom` import:

```tsx
const testAutomation = useSetAtom(testAutomationAtom)
const [isTesting, setIsTesting] = useState(false)

const handleTestConnection = useCallback(async () => {
    if (!initialValues?.id) return
    try {
        setIsTesting(true)
        const response = await testAutomation(initialValues.id)
        handleTestResult(response)
    } catch (error) {
        console.error(error)
        message.error(AUTOMATION_TEST_FAILURE_MESSAGE, 10)
    } finally {
        setIsTesting(false)
    }
}, [initialValues?.id, testAutomation])
```

### 1.5 Frontend: Remove the "pending" state from the table

**File:** `web/oss/src/components/pages/settings/Automations/Automations.tsx`

The status column currently shows "Active" vs "Test pending". Since the gate is gone, the row should no longer imply that the automation is blocked. For checkpoint 1, simplify the table to always show `Active`.

```tsx
{
    title: "Status",
    key: "status",
    render: () => <Tag color="success">Active</Tag>,
},
```

The more detailed delivery/test state will move to the future logs view in checkpoint 3.

### 1.6 Frontend: Show auto-ping feedback after create/edit

**File:** `web/oss/src/components/Automations/AutomationDrawer.tsx`

After a successful create or edit, the drawer currently shows a success toast and closes. Enhance this to also fire a client-side test and show the ping result:

```tsx
// In handleOk, after successful create/edit:
const subscriptionId = isEdit ? initialValues.id : response?.subscription?.id

// Close drawer and show creation success
message.success(isEdit ? "Automation updated" : "Automation created")
onSuccess()
onCancel()

// Then fire test and show ping result
if (subscriptionId) {
    try {
        const testResponse = await testAutomation(subscriptionId)
        handleTestResult(testResponse)
    } catch {
        message.warning(
            "Automation saved, but the connection test could not complete. You can retry it from the drawer or table.",
            10,
        )
    }
}
```

This gives users immediate feedback: "Automation created" followed by "Automation test successful" or "Automation test failed [404]". The automation is saved regardless.

### 1.7 Summary of changes

| Layer | File | Change | Size |
|-------|------|--------|------|
| Backend | `dispatcher.py` | Remove `is_valid` from matching filter | ~5 lines |
| Backend | `service.py` | Remove forced `is_valid=False` on create/edit | ~6 lines removed |
| Backend | `mappings.py` | Restore `is_valid` preservation on edit | ~2 lines |
| Frontend | `AutomationDrawer.tsx` | Restore test button + handler, trigger test after save | ~40 lines |
| Frontend | `Automations.tsx` | Remove pending state from status column | ~5 lines |

---

## Checkpoint 2: Test-draft endpoint (test before save)

**Goal:** Users can test webhook configuration from the drawer before creating/saving the subscription.

### 2.1 Backend: Extract HTTP delivery logic into reusable function

**File:** `api/oss/src/tasks/taskiq/webhooks/tasks.py`

The current `deliver_webhook()` function does three things:
1. Builds the HTTP request (resolve payload, compute auth headers, merge headers)
2. Makes the HTTP POST
3. Persists a delivery record

Extract steps 1-2 into a standalone function that both `deliver_webhook` and the new test-draft path can use:

```python
@dataclass
class WebhookRequestResult:
    """Result of executing a webhook HTTP request."""
    success: bool
    status_code: Optional[int] = None
    response_body: Optional[str] = None
    error: Optional[str] = None
    request_url: str = ""
    request_headers: Dict[str, str] = field(default_factory=dict)
    request_body: Optional[Dict[str, Any]] = None


async def execute_webhook_request(
    *,
    url: str,
    headers: Dict[str, str],
    payload_fields: Optional[Dict[str, Any]],
    auth_mode: Optional[str],
    encrypted_secret: str,
    event_context: Dict[str, Any],
    subscription_context: Dict[str, Any],
    project_id: UUID,
) -> WebhookRequestResult:
    """
    Build and execute a webhook HTTP request.
    
    Extracted from deliver_webhook so it can be reused
    for draft testing without persistence.
    """
    # ... existing logic from deliver_webhook:
    # 1. Build context dict
    # 2. Resolve payload_fields against context
    # 3. Validate URL
    # 4. Decrypt secret
    # 5. Compute auth headers (HMAC signature or Authorization)
    # 6. Merge user headers with system headers
    # 7. POST with httpx
    # 8. Return WebhookRequestResult
```

Then refactor `deliver_webhook` to call `execute_webhook_request` and handle persistence separately.

### 2.2 Backend: Add test-draft service method

**File:** `api/oss/src/core/webhooks/service.py`

```python
async def test_draft(
    self,
    *,
    project_id: UUID,
    #
    subscription: WebhookSubscriptionCreate,
) -> WebhookDelivery:
    """
    Test a webhook configuration without persisting it.
    
    Builds a mock event, encrypts the provided secret,
    and fires a direct HTTP request. Returns a delivery-like
    response with the result.
    """
    # 1. Encrypt the provided raw secret
    from oss.src.utils.encryption import encrypt
    encrypted_secret = encrypt(subscription.secret or "")

    # 2. Build mock event context (same shape as a real test event)
    event_id = uuid.uuid7()
    request_id = uuid.uuid7()
    event_type = WebhookEventType.WEBHOOKS_SUBSCRIPTIONS_TESTED

    event_context = {
        "event_id": str(event_id),
        "event_type": event_type.value,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "attributes": {"subscription_id": "draft"},
    }

    subscription_context = {
        "id": "draft",
        "name": subscription.name or "Draft Test",
    }

    # 3. Call the extracted HTTP delivery function directly
    result = await execute_webhook_request(
        url=str(subscription.data.url),
        headers=subscription.data.headers or {},
        payload_fields=subscription.data.payload_fields,
        auth_mode=subscription.data.auth_mode,
        encrypted_secret=encrypted_secret,
        event_context=event_context,
        subscription_context=subscription_context,
        project_id=project_id,
    )

    # 4. Build and return a WebhookDelivery DTO (not persisted)
    delivery = WebhookDelivery(
        id=uuid.uuid7(),
        subscription_id=uuid.UUID(int=0),  # sentinel for "draft"
        event_id=event_id,
        status=Status(
            message="success" if result.success else "failure",
            code=str(result.status_code) if result.status_code else None,
        ),
        data=WebhookDeliveryData(
            event_type=event_type,
            url=result.request_url,
            headers=result.request_headers,
            payload=result.request_body,
            response=WebhookDeliveryResponseInfo(
                status_code=result.status_code,
                body=result.response_body,
            ) if result.status_code else None,
            error=result.error,
        ),
    )

    return delivery
```

### 2.3 Backend: Add test-draft endpoint

**File:** `api/oss/src/apis/fastapi/webhooks/router.py`

Register in `__init__`:

```python
self.router.add_api_route(
    "/subscriptions/test-draft",
    self.test_draft,
    methods=["POST"],
    operation_id="test_webhook_draft",
    response_model=WebhookDeliveryResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_200_OK,
)
```

**Important:** This route must be registered BEFORE `/subscriptions/{subscription_id}` routes, otherwise FastAPI will try to match "test-draft" as a subscription_id UUID and return a 422.

Handler:

```python
@intercept_exceptions()
async def test_draft(
    self,
    request: Request,
    payload: WebhookSubscriptionCreateRequest,
) -> WebhookDeliveryResponse:
    # EE permission check (same as create)
    if is_ee():
        ...check EDIT_WEBHOOKS permission...

    delivery = await self.webhooks_service.test_draft(
        project_id=UUID(request.state.project_id),
        subscription=payload.subscription,
    )

    return WebhookDeliveryResponse(
        count=1,
        delivery=delivery,
    )
```

**No new request model needed** -- reuse `WebhookSubscriptionCreateRequest` since it has the same shape (subscription with data + secret).

### 2.4 Frontend: Add API function for test-draft

**File:** `web/oss/src/services/automations/api.ts`

```typescript
const testWebhookDraft = async (
    data: WebhookSubscriptionCreateRequest,
): Promise<WebhookDeliveryResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/webhooks/subscriptions/test-draft`,
        data,
    )
    return response.data
}
```

Add to exports.

### 2.5 Frontend: Add test-draft atom

**File:** `web/oss/src/state/automations/atoms.ts`

```typescript
export const testDraftAutomationAtom = atom(
    null,
    async (_get, _set, payload: WebhookSubscriptionCreateRequest) => {
        return await testWebhookDraft(payload)
    },
)
```

### 2.6 Frontend: Enable test button for drafts in the drawer

**File:** `web/oss/src/components/Automations/AutomationDrawer.tsx`

The test button from Checkpoint 1 was disabled for new (unsaved) subscriptions. Now enable it for both cases, using different code paths:

```tsx
const testAutomation = useSetAtom(testAutomationAtom)
const testDraftAutomation = useSetAtom(testDraftAutomationAtom)

const handleTestConnection = useCallback(async () => {
    try {
        setIsTesting(true)
        const rawValues = await form.validateFields()
        // ... process header_list same as handleOk ...
        const payload = buildSubscription(processedValues, false) as WebhookSubscriptionCreateRequest

        let response: WebhookDeliveryResponse

        if (isEdit && initialValues?.id) {
            // Existing subscription: use the persisted test endpoint
            response = await testAutomation(initialValues.id)
        } else {
            // Draft: use the test-draft endpoint
            response = await testDraftAutomation(payload)
        }

        handleTestResult(response)
    } catch (error) {
        if (error instanceof Error && error.message !== "Validation failed") {
            console.error(error)
            message.error(AUTOMATION_TEST_FAILURE_MESSAGE, 10)
        }
    } finally {
        setIsTesting(false)
    }
}, [form, isEdit, initialValues?.id, testAutomation, testDraftAutomation])
```

Update the button to always be enabled (remove the `disabled={!isEdit}` check):

```tsx
<Button
    loading={isTesting}
    onClick={handleTestConnection}
    disabled={isTesting}
>
    Test Connection
</Button>
```

**For edit mode with changed connection params:** When editing, the user might change the URL or secret. We should test the **draft values** (what's in the form), not the persisted subscription. So for edit mode, we should also use the test-draft endpoint with the current form values:

```tsx
// Simpler: always use test-draft with current form values
const handleTestConnection = useCallback(async () => {
    try {
        setIsTesting(true)
        const rawValues = await form.validateFields()
        const processedValues = { ...rawValues, headers: convertedHeaders }
        const payload = buildSubscription(processedValues, false) as WebhookSubscriptionCreateRequest
        const response = await testDraftAutomation(payload)
        handleTestResult(response)
    } catch (error) {
        // ...
    } finally {
        setIsTesting(false)
    }
}, [form, testDraftAutomation])
```

This is actually cleaner -- the test button always tests what's currently in the form, whether it's a new draft or an unsaved edit. One code path, predictable behavior.

### 2.7 Summary of changes

| Layer | File | Change | Size |
|-------|------|--------|------|
| Backend | `tasks/taskiq/webhooks/tasks.py` | Extract `execute_webhook_request()` from `deliver_webhook()` | ~80 lines (refactor, net neutral) |
| Backend | `service.py` | Add `test_draft()` method | ~50 lines |
| Backend | `router.py` | Add `POST /subscriptions/test-draft` route + handler | ~30 lines |
| Frontend | `api.ts` | Add `testWebhookDraft()` function | ~8 lines |
| Frontend | `atoms.ts` | Add `testDraftAutomationAtom` | ~5 lines |
| Frontend | `AutomationDrawer.tsx` | Update test handler to always use draft testing | ~15 lines changed |

---

## Checkpoint 3: Delivery log UI (future, not detailed here)

- Widen the drawer or convert to a page
- Add tabs: "Configuration" (current form) and "Delivery Log"
- Delivery Log tab calls `POST /webhooks/deliveries/query` filtered by `subscription_id`
- Display as a table: timestamp, event type, status code, success/failure
- Expandable rows showing request/response details
- Similar layout to prompt registry's Overview/JSON tabs
