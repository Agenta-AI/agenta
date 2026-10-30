# Naming and consistency rules

Each rule says what to check and what evidence makes it a finding. A rule is a prompt to
look, not a quota.

## 1. One term per concept

- One word means one thing inside one context, in every layer. Two different behaviors never
  share a name.
- Read the new names next to the interfaces around them, and guess what each call does before
  you read its code. A wrong guess means the name needs work.
- Keep a stable shipped name unless the benefit pays for the migration
  (`resource-template.md`, section 8).
- Evidence: the two places, the two meanings, and a reader who would guess wrong.

- A key that joins two things (an item to an account, a claim to a row) uses one vocabulary
  on both sides. List its values and the source of each. When two vocabularies exist for one
  thing (a product name and a provider name, a display name and a catalog key), the spec
  says which one is the key and where the mapping lives.

## 2. Same word in two contexts, or overloading

- One word may mean two things in two separate models, as long as one explicit mapping sits
  between them and each model writes only its own state.
- Inside one context, one word must not carry two meanings. That is overloading.
- Decide which case applies before you raise a finding. A shared module, a shared table or a
  shared config object means one context.

## 3. One verb set and complete pairs

- Use one verb set for the actions on every item kind in a domain. Do not mix `remove`,
  `delete` and `destroy`, or `fetch`, `get` and `read`, inside one domain.
- If one half of a pair exists, the other half exists with the matching name: `connect` and
  `disconnect`, `archive` and `unarchive`, `add` and `remove`, `start` and `cancel`.
- A UI verb and the API verb for the same action say the same thing, or the per-layer table
  records why not.

## 4. Vague names and names that are hard to pick

- Flag generic names (`data`, `info`, `handle`, `manager`, `process`, `status`, `type`,
  `scope`, `mode`, `config`, `options`) when they hide more than one meaning or invite the
  wrong reading. Short local names are fine.
- A name must say what the field means, not where it came from or which list it sits in.
- A word with an established meaning in the code or the domain is wrong for a different
  meaning, even when the definition is written down: `scope` (access or permission scope),
  `default` (the value used when nothing is chosen), `status`, `type`.
- A name that needs a rule to stop readers from misreading it ("never show it as X", "keep
  the two labels apart", "this field does not mean Y") is a misleading name. The rule is the
  evidence.
- When a name keeps changing across drafts, look for two concepts merged into one. Check the
  design before you rename.
- Evidence: a reader could take the name two ways, and only one is what the code or spec does.

## 5. Enum values from one scheme

- The values of one field answer the same question in the same form. A field whose values
  mix two schemes (one says who, another says where; one is a noun, another an adjective
  phrase; one names an owner kind, another a role) is a finding.
- The values reuse words the glossary already has, for example the owner kinds.

## 6. Field names

- A number with a unit carries the unit as a suffix: `timeout_ms`, `size_bytes`,
  `ttl_seconds`.
- A repeated field uses the plural.
- Timestamps use the `_at` suffix (`project-conventions.md`, Lifecycle times).
- A boolean is `is_<adjective>`. Where it is stored (a `flags` key or a column) follows
  `project-conventions.md`, Boolean state and Boolean column.
- A string id from a catalog ends in `_key`.
- An id field of another item is `<item>_id`.

## 7. Module and folder names

- One rule for folder number in each layer. In the API, domain folders are mostly plural
  (`project-conventions.md`, Domain folder number).
- Two folders whose names differ only by number (`thing/` next to `things/`), in any layer,
  are a finding unless their names say what each one owns.
- A folder name, its route prefix and its table prefix name the same concept, or the
  per-layer table says why not.
- The finding names the concept each folder owns and where a reader would look for a
  change.

## 8. The same pattern for every kind

- When several features do the same job (several kinds of stored login, several kinds of
  agent item), they use the same layers, folder layout, DTO shape, field names, route
  pattern, indexes and UI words.
- A feature that bypasses the dominant pattern is a finding unless the spec says why.
- Matching a known bad pattern is not a reason to copy it. Name the problem and keep it out of
  the new surface.
- Check across item kinds and across owner kinds. A rule written for one kind or one owner
  level and silent for the others is a gap.

## 9. Labels

- A UI label names the same concept as the code term. Two fields that are different
  concepts get labels that a user cannot confuse.
- A label does not show an internal word that misleads users (a code name that does not mean
  what it says).
- Error text for users is plain and non-technical.
