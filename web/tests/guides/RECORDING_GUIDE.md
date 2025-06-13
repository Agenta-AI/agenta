# Agenta E2E Recording Guide

## Purpose
This guide provides best practices and instructions for recording E2E flows using Playwright codegen in Agenta Cloud. It ensures that all interactions, API assertions, and debug logging are captured effectively for robust test generation. These instructions must be followed by the agent when referenced by a workflow.

---

## How to Record an E2E Flow

1. **Start the Recording Session**
   - ask user for the url, if it wasn't provided already.
   - Update .env file with the PROJECT_DIRECTORY variable, according to the project you want to record the test in.
   - Cascade (the agent) will utilize the playwright mcp server to start a recording and inspect its output and the generated code.
   - **Important:** Only actions performed in the Playwright browser window (which opens automatically) are recorded. Actions in browser previews or regular browsers are NOT captured.
   - If no window opens, check for errors in the terminal. ENOENT errors usually mean the output path is incorrect for your monorepo; use a relative path from the `web/` directory (e.g., `ee/tests/codegen/...`).
   - You will interact with the Playwright browser window that opens after you approve the command.

2. **Perform the Flow**
   - Interact naturally with the application, covering the flow you want to test.
   - Perform all relevant user actions (navigation, clicks, form fills, etc.).
   - Try to cover edge cases and state changes if relevant.

3. **API Assertions & Debug Logging**
   - Note which API endpoints are critical for the flow. After recording, these can be asserted in the generated test using `apiHelpers.waitForApiResponse`.
   - Use debug logging (e.g., `console.log`) where needed to inspect API responses, request URLs, and state transitions.
   - If you want to assert specific API endpoints, list them at the end of your recording session for Cascade to include in the E2E test.

4. **Finishing Up**
   - When done, notify Cascade to end the session.
   - Cascade will analyze the generated code, supplement it with robust API assertions and debug logging, and create a summary file documenting the session.

---

## Tips for Effective Recordings
- Use real data where possible to ensure selectors are robust and dynamic.
- Trigger all important UI state changes and API calls you want covered in the test.
- Avoid unnecessary or redundant actions to keep the test focused.
- If a flow involves authentication, ensure you start from a clean state or follow the global authentication setup.

---

## References
- [E2E Test Generation Guide](./E2E_TEST_GENERATION_GUIDE.md)
- [Utilities & Fixtures Guide](./UTILITIES_AND_FIXTURES_GUIDE.md)
- [E2E Test Organization Guide](./E2E_TEST_ORGANIZATION_GUIDE.md)
