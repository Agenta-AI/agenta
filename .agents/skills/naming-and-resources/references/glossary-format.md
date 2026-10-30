# Glossary format

A glossary fixes the one word we use for each project concept. Reviewers check names against
it.

## Where it lives

- Put it in the spec folder, as a "Terms" or "Glossary" section of the design. When several
  specs share the terms, use a `GLOSSARY.md` beside them.
- Start it when the first term is settled. An empty glossary has no use.
- Keep one glossary per context. A context is an area with its own model, for example billing
  or agent accounts. If a word means two things in two contexts, see "Same word in two
  contexts" in `naming-rules.md`.

## Entry format

```md
## <Heading for a group of related terms>

**<Term>**: <what the thing is, in at most two sentences>
_Avoid_: <word we rejected>, <word we rejected> (<the case where the word is fine, if any>)
```

Example:

```md
**Workflow**: a versioned unit of work that Agenta runs, such as an application, an
evaluator or an agent.
_Avoid_: app (except in legacy routes), pipeline, flow
```

## Rules

- **Choose one word.** Competing words for a concept go on the Avoid line, so nobody has to
  decide twice.
- **Keep the definition short.** Two sentences at most, and they say what the thing is rather
  than how it behaves.
- **Leave out general programming words.** Words such as timeout, error or cache stay out, even
  when the project uses them often. The glossary holds words that mean something special here.
- **Keep storage out of the definition.** Table, column and route names belong in the per-layer
  name table (`layer-name-table.md`).
- **Use headings when the list grows.** A small context can stay a flat list.
- **Add the values people see.** An enum value, a mode or a state that users or authors meet
  gets its own entry, and its UI label goes in the per-layer table.
- **Flag unsettled words.** Add `(open: <question>)` after the definition, so a reviewer knows
  the choice is still under discussion.

## Testing terms as you write

- If the spec or a person uses a word against its glossary meaning, raise it right away. Quote
  both meanings and ask which one applies.
- If one word is doing two jobs, suggest a separate exact word for each job.
- If nobody can settle on a name, look for two concepts that have been merged, and check the
  design first.
- Read the code as well. When it contradicts the spec, cite the file and the line.
- Try each term on an awkward case (nothing there, a second owner, a rename). Change the
  definition if the case breaks it.
