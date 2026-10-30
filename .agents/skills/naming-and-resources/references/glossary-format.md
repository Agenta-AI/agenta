# Glossary format

A glossary gives each project concept one word. It is the list a reviewer checks names
against.

## Where it lives

- In the spec folder, as a "Terms" or "Glossary" section of the design, or as `GLOSSARY.md`
  next to it when several specs share the terms.
- Create it when the first term is settled, not before.
- One glossary per context. A context is an area with its own model, for example billing or
  agent accounts. If two contexts use one word with two meanings, see "Same word in two
  contexts" in `naming-rules.md`.

## Entry format

```md
## <Cluster heading, when terms form groups>

**<Term>**: <one or two sentences that say what it is, not what it does or how it is stored>
_Avoid_: <rejected word>, <rejected word> (<when the word is fine, if ever>)
```

Example:

```md
**Workflow**: a versioned unit of work that Agenta runs, such as an application, an
evaluator or an agent.
_Avoid_: app (except in legacy routes), pipeline, flow
```

## Rules

- **Be opinionated.** When several words exist for one concept, pick the best one and list
  the others under Avoid.
- **One or two sentences.** Define what the thing is.
- **Project terms only.** General programming words (timeout, error, cache) do not belong,
  even if the project uses them a lot.
- **No implementation details in the definition.** Table, column and route names go in the
  per-layer name table (`layer-name-table.md`), not in the definition.
- **Group terms** under subheadings when clusters appear. A flat list is fine for a small
  context.
- **Every value of a fixed set is a term** when users or authors see it (an enum value, a
  mode, a state). Its UI label goes in the per-layer table.
- **Mark open terms.** A term still under discussion gets `(open: <question>)` after its
  definition, so reviewers do not treat it as settled.

## Challenging terms while you write

- When the spec or a person uses a word that conflicts with the glossary, say so at once:
  "The glossary says X means A. Here it seems to mean B. Which one is right?"
- When a word is vague or carries two meanings, propose one precise word for each meaning.
- When a name is hard to choose, suspect that the concept mixes two things. Look at the
  design before you pick a word.
- Check the code. If the code disagrees with what the spec says, show the contradiction with
  the file and line.
- Test each term with a concrete scenario at its edge (an empty case, a second owner, a
  rename) and see if the definition still holds.
