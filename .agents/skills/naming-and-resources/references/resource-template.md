# Resource template

Every stored item kind in Agenta has the same base shape and the same actions. A new kind
copies the template, or the spec records why it differs. The template comes from our code
(`project-conventions.md`). Generic API standards fill gaps only where we have no convention.

## 1. Fields every item has

| Group | Fields | Notes |
| --- | --- | --- |
| Identity | `id` | UUID v7. Every later operation uses the id. |
| Address | `slug` | Unique per owner. An address is not an identity: it can be reused after delete. |
| Header | `name`, `description` | Display text. |
| Owner | `organization_id`, `project_id`, `user_id` as needed | See section 3. |
| Lifecycle | `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` | Use `LifecycleDBA`. |
| Metadata | `flags`, `tags`, `meta` | Boolean state as `is_*` keys in `flags`, unless a constraint needs a column. |
| Kind | `kind` or `type` | Only when one table holds several kinds. Use the sibling table's word. |
| Payload | `data`, `status` | Kind-specific content and server-reported state. |

Check: for each new kind, list the fields it has, lacks and adds. Each missing or extra field
needs a reason.

## 2. Siblings share the shape

When several tables hold items that play the same role (for example several kinds of stored
login), the shared role gets the same columns, the same column names, the same constraint
and index shapes, and the same DTO field names in every sibling table. A rule that the spec
writes for one sibling (an index, a default, a check constraint, a lifecycle rule) is written
for every sibling, or the spec says why one sibling differs.

## 3. Owner and parent

- An item has at most one canonical parent. A list call must not need two parents.
- When an item can belong to different owner kinds (a person, a project, an organization),
  write down: the owner columns, the check constraint that says which combinations are
  valid, and how each owner kind addresses the item.
- A rule that depends on the owner (uniqueness of the slug, one default, who may read) is
  stated for every owner kind the item allows, not only the new one. Per owner kind, say
  whether the rule holds, and the index or constraint that enforces it.
- A column added to the rows of every owner kind has a stated meaning for each owner kind.
  A column that exists on project rows but whose rule and index cover only person rows is
  a gap, even if a decision log says the other owners do not use it: then drop the column
  for them or constrain it.
- Deletion follows ownership. Say what deleting the owner (a person leaving, a project
  deleted) does to the item, and what it does to items that point at it.

## 4. Standard actions

Every kind offers the same actions with the same shapes, named with the verb set of the
domain it extends (`project-conventions.md`, Operation ids):

| Action | Route | Returns |
| --- | --- | --- |
| Create | `POST /` | the item |
| Fetch | `GET /{<entity>_id}` | the item |
| Edit | `PUT /{<entity>_id}` | the item |
| Query or list | `POST /query` (or `GET /` where the domain uses it) | `count` and the items, with `Windowing` |
| Archive and unarchive, or delete | `POST /{<entity>_id}/archive`, `/unarchive`, or `DELETE /{<entity>_id}` | the item, or nothing for delete |

- Fetch, create and edit answer with the item, inside the domain's usual response envelope.
- Sibling kinds use the same route pattern and the same response field names.
- A kind that skips an action says why.

## 5. Custom actions

- Prefer a standard edit of a field over a new action route.
- Add a custom action only for work the standard set has no way to do: a state change with side
  effects, a change to several rows at once, or an operation that writes no field.
- Name it with a verb from the glossary. Use the project pattern
  `POST /{<entity>_id}/<verb>`.
- Ask first whether the feature works with no new public surface at all.

## 6. Field ownership

- A field is set by the caller or by the server, never both without a rule.
- A server-set field is output only.
- A field that the server fills and the caller may change needs a written rule for which
  value wins, and what happens when its source changes later.

## 7. Enums and states

- A field with a fixed set of values is an enum, not a free string.
- All values of one enum follow one naming scheme: the same part of speech, the same
  reference point (all say who, or all say what), the same word order.
- The value that a missing field means is written down.
- A state that the system changes is output only, and moves only through named actions.
- Each value has a UI label in the per-layer table, and the label says the same thing as
  the value.

## 8. Changing a shipped name

- Before a rename, retype or removal of a shipped field, list what sees it: stored rows and
  stored JSON (saved revisions), old clients and SDKs, the runner, and mixed-version deploys.
- Additive changes are usually safe. Renames are not, and a column rename fails the
  migration gate.
- A naming fix on a shipped name needs a migration plan (expand and contract) or a recorded
  exception in the per-layer table.
- A new surface does not copy a shipped mistake to stay consistent. Record the shipped name
  as an exception and use the right name in the new surface, or record why reuse is better.
