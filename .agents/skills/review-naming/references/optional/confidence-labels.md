# Confidence labels (optional)

Load when the caller asks for a confidence label on each finding. Confidence is separate
from severity.

- **Verified**: a test, a query or a command output shows it.
- **Supported by inspection**: you read the full code or spec path that shows it.
- **Unconfirmed**: a premise is missing. Move the item to Questions.

Add one line per finding: `- Confidence: Verified | Supported by inspection`.
