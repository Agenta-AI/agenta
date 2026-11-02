# Empty, missing, null and zero (optional)

Load this page when a field can be absent, null, empty or zero.

- For each such field, write down what each of these means: the key is absent, the value is
  `null`, the value is empty (`""`, `[]`, `{}`), the value is zero or `false`.
- Keep them distinct when they mean different things. Merge them only when the meaning is
  the same.
- A field that is required for some kinds and null for others says, per kind, whether null
  means "not applicable" or "not set yet". Every reader of the column must use the same
  meaning.
- A field omitted from stored JSON (old saved revisions) reads as a documented value. Write
  that value in the spec, next to the field.
- Prefer a general rule that covers edges over special cases. Do not merge "empty",
  "absent", "denied" and "failed" to remove one `if`.
