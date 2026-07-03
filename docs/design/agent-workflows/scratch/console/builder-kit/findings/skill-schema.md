# Skill schema (agent-config `parameters.agent.skills`) — ground truth

Investigated 2026-07-01 against the SDK models, the API static catalog, and the
`skill-template` catalog type. The playbook's "a skill has exactly three fields
(`name`, `description`, `body`)" is **incomplete/wrong**: a skill has up to **six**
fields and can bundle a folder of extra files.

## The model: `SkillTemplate`

Definition: `sdks/python/agenta/sdk/agents/skills/models.py:77`
(`model_config = ConfigDict(extra="forbid")` — unknown fields are rejected).

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `name` | str | yes | lowercase, digits, single hyphens; 1–64 chars; regex `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `description` | str | yes | 1–1024 chars. The trigger the model matches; read by every harness |
| `body` | str | yes | 1–50,000 chars. The SKILL.md Markdown body written after the composed frontmatter |
| `files` | `List[SkillFile]` | no | default `[]`. Bundled scripts / references laid beside SKILL.md |
| `disable_model_invocation` | bool | no | default `false`. Pi/Claude: hide from prompt, only reachable via `/skill:name` |
| `allow_executable_files` | bool | no | default `false`. Default deny; the sandbox policy must also allow execution |

### `SkillFile` (one bundled file)

Definition: `sdks/python/agenta/sdk/agents/skills/models.py:49`
(`extra="forbid"`).

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `path` | str | yes | 1–255 chars. **Safe relative POSIX path**: no leading `/`, no backslash, no `..` segment, and not `SKILL.md` (reserved for the composed frontmatter). e.g. `scripts/foo.py` |
| `content` | str | yes | ≤200,000 chars. Inline UTF-8 text (binary → a future `uri` variant) |
| `executable` | bool | no | default `false`. `chmod +x` only if `allow_executable_files` AND the sandbox policy allow it |

## Where the `["path","content"]` required set comes from

The catalog type `skill-template` (`GET /api/workflows/catalog/types/skill-template`) is
emitted by `SkillTemplateSchema` (`sdks/python/agenta/sdk/utils/types.py:1487`), whose
`files` field (`types.py:1520`) is `List[_SkillFileSchema]`. `_SkillFileSchema`
(`types.py:1447`) is the per-file item and its required set is exactly `["path","content"]`
(`executable` defaults to false). So the schema shows **two required sets** because it is a
nested object: the top-level `SkillTemplate` requires `["name","description","body"]`, and
each element of `files[]` requires `["path","content"]`. That second set is the
`files[]` **item shape**, not a second top-level variant.

The registry wires the type at `types.py:1617` (`SkillTemplateSchema.ag_type() == "skill-template"`).

## Folders / directories on the wire

There is **no** separate "folder" object. A folder is expressed by putting `/`-separated
segments in a file's `path`. `files: [{path: "scripts/run.py"}, {path: "references/api.md"}]`
materializes into a directory tree beside SKILL.md. The runner writes each file to its
relative path under the skill dir (the parent of SKILL.md), so nested dirs fall out of the
paths. Path safety is validated on the model itself (`_validate_safe_skill_file_path`,
`models.py:21`), so a path can't escape the skill dir or clobber the composed `SKILL.md`.

Wire serialization (`SkillTemplate.to_wire`, `models.py:102`) is camelCase to match
`services/agent/src/protocol.ts`'s `WireSkill`; optional fields are omitted when unset:

- always: `name`, `description`, `body`
- `files` — array of `{path, content, executable}` — only when non-empty
- `disableModelInvocation: true` — only when set
- `allowExecutableFiles: true` — only when set

## Inline vs `@ag.embed` (how skills are authored)

A `skills` entry is one of two shapes (`AgentTemplateSchema.skills`, `types.py:1228`,
`List[Union[_SkillTemplateRefSchema, _SkillEmbedRefSchema]]`):

1. **Inline** — a full `SkillTemplate` object written directly in the list (the
   `skill-template` catalog type describes its editable shape). `agenta_builtins.py`
   constructs its platform skills this way, e.g. `GETTING_STARTED_WITH_AGENTA_SKILL`
   (`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:96`) with just
   `name`/`description`/`body` (no files — a minimal but valid skill).

2. **Reference** — a bare `@ag.embed` object pointing at a stored/static workflow; the
   backend inlines it into a `SkillTemplate` **before the runner sees it**. The default
   agent template embeds the platform skill by reserved slug
   (`api/oss/src/apis/fastapi/applications/overlay.py:25`):

   ```jsonc
   {
     "@ag.embed": {
       "@ag.references": { "workflow": { "slug": "__ag__getting_started_with_agenta" } },
       "@ag.selector":   { "path": "parameters.skill" }
     },
     "name": "agenta-getting-started"   // display-only sibling, discarded on resolution
   }
   ```

   The static catalog stores that skill as `parameters.skill = SkillTemplate.model_dump()`
   (`api/oss/src/core/workflows/static_catalog.py:76`), and the `@ag.selector` pulls the
   flat inline `SkillTemplate` shape back out. Whatever the author writes, by the time the
   `/run` wire is built every `skills` entry is a concrete `SkillTemplate`
   (`dtos.py:713` `wire_skills` → `skills_to_wire`).

## Correct JSON example — a skill WITH extra files (a folder)

```json
{
  "name": "invoice-parser",
  "description": "Parse a PDF invoice into structured line items. Use when the user uploads an invoice and wants totals extracted.",
  "body": "# Invoice parser\n\nRun `scripts/parse.py <file.pdf>` to extract line items. See `references/schema.md` for the output shape.\n",
  "files": [
    {
      "path": "scripts/parse.py",
      "content": "import sys\nprint('parsing', sys.argv[1])\n",
      "executable": true
    },
    {
      "path": "references/schema.md",
      "content": "# Output schema\n\n- vendor: string\n- total: number\n- lines: array\n"
    }
  ],
  "allow_executable_files": true,
  "disable_model_invocation": false
}
```

On the wire (camelCase, minimal-omitting) this becomes `name`/`description`/`body` plus a
`files` array of `{path, content, executable}` and `allowExecutableFiles: true`.
`disableModelInvocation` is omitted because it's false. The two files materialize as
`scripts/parse.py` and `references/schema.md` under the skill directory — that is how a
"folder" is carried.

## One-line correction for the playbook

An inline skill has up to **six** fields — `name`, `description`, `body`, plus optional
`files` (an array of `{path, content, executable}` bundled scripts/references that can form
sub-folders via `/`-separated paths), `disable_model_invocation`, and
`allow_executable_files`; `name`/`description`/`body` alone is a *valid but minimal* skill,
not the whole schema.
