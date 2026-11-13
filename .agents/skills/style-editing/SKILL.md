---
name: style-editing
description: >-
  Make prose plain, clear and easy to read: common words, whole sentences, no
  dashes, no made-up terms, no comparisons, plus Joseph Williams' revision
  principles (characters as subjects, actions as verbs, old before new). Use it
  when you write or revise a document, report, summary, README, email, slide,
  commit message or PR description, when someone asks you to simplify, reword,
  tighten or clean up text, or when they mention Williams' "Style". It also runs
  for the command `/style-editing deslopify`, which rewrites an agent reply.
  Apply it to the words around code and never to the code.
---

# Style editing

Write so a reader understands the text on the first read, even if the text feels
dull. Part 1 holds the house rules that every text must follow. Part 2 holds
Joseph Williams' revision principles, which you use to find and fix an unclear
sentence. When the two parts disagree, Part 1 wins.

# Part 1: House rules

The "Avoid" and "Prefer" lines show each rule at work.

## Words

- **Pick the common word.** Skip a formal synonym when a simple word does the
  job. Be careful with words that AI tools overuse, such as "robust", "leverage",
  "reach", "delve", "landscape" and "tapestry".
  Avoid: We leverage a queue to enable a more robust import flow.
  Prefer: We use a queue so an import can resume after a crash.
- **Write the way people talk.** Do not coin a term or a shorthand. If a standard
  dictionary doesn't list the word, leave it out. A technical term is fine when
  no other word is as exact, and you add a short definition if the reader may not
  know it.
  Avoid: The metric is a noisy signal of user intent.
  Prefer: The metric gives a rough idea of what users want.
- **Cut words that add force and no facts.** Watch for "pivotal", "quietly",
  "renowned", "boasts", "worth", "matters", "real", "really", "carries weight" and
  "a testament to". Give the fact, or delete the sentence.
  Avoid: Sign-ups are a pivotal concern, and the numbers are worth a look.
  Prefer: Sign-ups fell by a third, so we will fix the form first.
- **Use one word for one thing.** Keep your vocabulary small.
  Avoid: Open the report. The page loads, and the document shows a chart.
  Prefer: Open the report. The report loads and shows a chart.
- **Use contractions when you like.** People use them when they speak.
  Avoid: You do not need to restart, and it will not lose your work.
  Prefer: You don't need to restart, and it won't lose your work.
- **Do not build new hyphenated adjectives.** A compound from the dictionary, such
  as "well-known", is fine. A compound you made up to save words is not.
  Avoid: We added a retry-aware, sync-style job.
  Prefer: We added a job that copies the files and retries when a copy fails.
- **Stay dull and descriptive everywhere.** Headings, labels, callouts, summaries
  and first sentences don't get slogans or clever phrases.
  Avoid: # Shipping without fear
  Prefer: # How we test a release

## Sentences

- **Finish every sentence.** It needs someone or something to act and a verb for
  the action. Don't write fragments, and don't use a colon or a semicolon to
  attach an unrelated idea. Related ideas can share a sentence through "and",
  "because" or "so".
  Avoid: The backup runs at night, and the office closes on Fridays.
  Prefer: The backup runs at night. The office closes on Fridays.
- **Number the steps of a process in words.** Start them with "First", "Second"
  and "Third", with one sentence per step.
  Avoid: The file was checked by the importer after the upload, and the rows it
  rejected went to a report that the owner read.
  Prefer: First, the user uploads the file. Second, the importer checks each row.
  Third, the owner reads a report of the rejected rows.
- **Keep a sentence to one or two clauses.** When you have more points than that,
  use numbered steps, or use short bullets if you are writing a brief. Two
  example sentences in a row is the limit for any one point.
- **Let a thought run long instead of chopping it up.** Ordinary prose reads best
  in the longer, comma-joined sentences that people use to explain something out
  loud. A stack of short, punchy sentences or catchy phrases is wrong. You can keep
  lines short in labeled briefs, bullets and numbered steps.
  Avoid: The check runs nightly. It catches broken links. Nobody skips it.
  Prefer: The check runs every night and reports broken links, and it fails the
  build unless someone turns it off by hand.
- **Say exactly what happens.** Name the change, the actor or the mechanism, and
  replace a vague abstraction with a concrete statement. Delete side clauses that
  hold no fact, e.g., "going forward", "at the end of the day" or "for now".
  Avoid: With better logs, debugging becomes a breeze going forward.
  Prefer: The logs now include the request id, so you can find every step of one
  failed request.

## Paragraphs and chat

- **Open with the point.** The first sentence of a paragraph or section states the
  main idea. The next sentence gives a fact or an example that supports the idea.
  Bring in further support with a simple connector such as "For example", "Also"
  or "Or".
- **In a chat, set the scene first.** Assume a smart reader who never knew the
  problem, or who has forgotten the problem. Briefly say what the problem was and
  what was going on, and then say what changed. Don't retell the whole history.
  Avoid: The sync now backs off, and the tests pass.
  Prefer: The calendar sync was hitting the rate limit and dropping events. The
  sync now waits for the time the server asks for, and the four sync tests pass.

## Punctuation and layout

- **No em dashes, en dashes or middle dots.** Use a period or "and" between
  clauses, "to" in a range, and a comma, "and" or a new line in place of a middle
  dot.
  Avoid: The build is slow — it takes 5–10 minutes.
  Prefer: The build is slow. It takes 5 to 10 minutes.
- **Keep colons for lists and labels.** A colon may come before a list, or follow
  a short label such as "Summary:" or "Next steps:". Don't use a colon in ordinary
  prose to tie two clauses together or to build up to a point.
  Avoid: The answer is simple: the cache was stale.
  Prefer: The cache was stale.
- **Use straight quotes.** The ASCII `"` is the only double quote mark to use.
- **Format simply.** Headings use sentence case, and bold is never decoration.
- **Use lists with restraint.** Three or four points is the limit, so nest the
  rest under group names. Essays should rarely use lists or tables.

## Patterns to leave out

- **False actors.** Don't write as if an object decides or transforms on its own
  when a person or a process does the work. Simple factual verbs are fine, e.g.,
  "The API returns a list".
  Avoid: The data turns into insights once the export completes.
  Prefer: You can read the charts when the export completes.
- **Comparisons and imagery.** Don't explain by likeness or by metaphor. Say what
  the thing does, in words that mean only that.
  Avoid: The router acts as a traffic cop for requests.
  Prefer: The router reads the path and sends each request to one handler.
- **"Not just X, it is Y" and "not only X, but Y".** Give the plain description.
  Avoid: It is not only a logger, it is an observability suite.
  Prefer: It writes logs and draws charts from them.
- **Stacks of rhetorical questions.** State the open problem directly.
  Avoid: Will people trust the score? Will they act on it?
  Prefer: We don't know yet if people trust the score or if they act on it.
- **Loose "this", "that", "these" and "those".** Name the noun instead. Don't
  begin a sentence with a demonstrative pronoun.
  Avoid: That fixes it for the next run.
  Prefer: The new default fixes the timeout on the next run.
- **Openings that count.** Don't announce how many points will follow, e.g., "Two
  risks." Start with the first point.

# Part 2: Williams' revision principles

From Joseph M. Williams' *Style: Lessons in Clarity and Grace*. Skilled writers
don't write clear sentences on the first try. They revise into them, so use these
principles in a revision pass.

1. **Characters as subjects, actions as verbs.** Ask "who is doing what?" and make
   the actor the subject and the action the verb.
   Avoid: There was a decision by the committee to approve the budget.
   Prefer: The committee decided to approve the budget.
2. **Turn nominalizations back into verbs.** Watch for nouns made from verbs
   (-tion, -ment, -ance, -ence, -ity, -ness) and for phrases such as "make a
   decision", "conduct an analysis of" and "give consideration to". Write
   "decide", "analyze" and "consider".
3. **Active over passive.** Use the passive only when the actor is unknown or
   unimportant, or when the passive keeps the same subject across sentences.
4. **Put the most important new information at the end.** Readers feel the
   emphasis of a sentence at its end, in the stress position.
   Avoid: Climate change is the most pressing issue, in my opinion.
   Prefer: In my opinion, the most pressing issue is climate change.
5. **Old before new.** Start each sentence with information the reader already
   has, and end with the new information. Each sentence then picks up where the
   last one stopped.
6. **Keep a topic string.** List the grammatical subject of each sentence in a
   paragraph. If the subjects keep changing, pick one main character and rewrite
   so most sentences share that subject.
7. **Cut what you don't need.** Replace wordy phrases ("due to the fact that" to
   "because", "in order to" to "to", "in the event that" to "if"). Keep one word
   of a doublet ("each and every", "first and foremost"). Delete empty modifiers
   ("very", "basically", "actually", "simply") and throat-clearing openers ("It
   should be noted that").
8. **Use parallel structure in lists.** Write "hiking, swimming and biking", not
   "hiking, swimming and to bike".
9. **Write to others as you want them to write to you.** Don't use jargon that
   excludes readers, hedges that hide who is responsible ("mistakes were made"),
   or complexity that signals authority instead of meaning.

## Revision checklist

1. Subject test. Is there a topic string in each paragraph?
2. Verb test. Are the verbs concrete actions, or nominalizations and weak verbs?
3. Voice test. Does each passive sentence have a reason?
4. Stress test. Does each sentence end on its most important word?
5. Cut test. Which words can you delete without losing meaning?
6. House-rule test. Does the text break any rule in Part 1?
7. Reader test. Does a new reader understand the text on the first read?

# The deslopify command

`/style-editing deslopify` means that you rewrite the last agent reply, or the
text that follows the command. Write for a sharp executive or engineer who knows
nothing about the project, and return the rewrite with nothing around it.

Put the main conclusion first. After the conclusion, give the background and how
the thing works, in a logical order. Keep the technical details the reader needs,
use established terms in place of new ones, and define any term the reader may
not know. All the rules above apply.
