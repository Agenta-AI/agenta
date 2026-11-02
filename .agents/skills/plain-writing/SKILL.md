---
name: plain-writing
description: >-
  Makes prose plain and easy to read, with common words, whole sentences, no
  dashes, no made-up terms and no comparisons. Use it when you write or revise a
  document, report, summary, README, email, slide, Notion page, commit message
  or PR description, or when someone asks you to simplify, reword, tighten or
  clean up text. It also runs for the command `/plain-writing deslopify`,
  which rewrites an agent reply. Apply it to the words around code and never to the code.
---

# Plain writing

Write so a reader understands the text on the first read, even if the text feels
dull. Use these rules by default for anything you write for the user. The
"Avoid" and "Prefer" lines show each rule at work.

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
  Avoid: Cost as a guardrail
  Prefer: Limits on what one run may spend

## Sentences

- **Finish every sentence.** It needs someone or something to act and a verb for the action. Don't write
  fragments, and don't use a colon or a semicolon to attach an unrelated idea.
  Related ideas can share a sentence through "and", "because" or "so".
  Avoid: The backup runs at night, and the office closes on Fridays.
  Prefer: The backup runs at night. The office closes on Fridays.
- **Number the steps of a process in words.** Start them with "First", "Second" and
  "Third", with one sentence per step. Semicolons between the steps are
  also fine.
  Avoid: The file was checked by the importer after the upload, and the rows it
  rejected went to a report that the owner read.
  Prefer: First, the user uploads the file. Second, the importer checks each row.
  Third, the owner reads a report of the rejected rows.
- **Keep a sentence to one or two clauses.** When you have more points than that,
  use numbered steps, or use short bullets if you are writing a brief. Write
  examples inside a sentence after "e.g.". Two example sentences in a row is the
  limit for any one point.
  Avoid: The client sends the form, the server stores the row, and the worker
  sends the email.
  Prefer: The client sends the form, and the server stores the row. A worker then
  sends the email.
- **Let a thought run long instead of chopping it up.** Ordinary prose reads best
  in the longer, comma-joined sentences that people use to explain something out
  loud. A stack of short, punchy sentences or catchy phrases is wrong. You can keep
  lines short in labeled briefs, bullets and numbered steps, as in "To do: check
  the retry limit."
  Avoid: The check runs nightly. It catches broken links. Nobody skips it.
  Prefer: The check runs every night and reports broken links, and it fails the
  build unless someone turns it off by hand.
- **Say exactly what happens.** Name the change, the actor or the mechanism, and
  replace a vague abstraction with a concrete statement. Delete side clauses that
  hold no fact, e.g., "going forward", "at the end of the day" or "for now". A
  long sentence is fine when the content needs the length, and padding is not.
  Avoid: With better logs, debugging becomes a breeze going forward.
  Prefer: The logs now include the request id, so you can find every step of one
  failed request.

## Paragraphs and chat

- **Open with the point.** The first sentence of a paragraph or section states the
  main idea. The next sentence gives a fact or an example that supports the idea,
  and one more sentence can expand on the fact. Bring in further support with a
  simple connector such as "For example", "Also" or "Or".
  Avoid: The page caches the list. The server skips the count. Most loads are
  quick.
  Prefer: Most loads are quick. For example, the page caches the list, so a second
  visit sends no request. Also, the server skips the count when nothing changed.
- **In a chat, set the scene first.** Assume a smart reader who never knew the
  problem, or who has forgotten the problem. Briefly say what the problem was and
  what was going on, and then say what changed. Don't retell the whole history.
  Essays don't need this rule.
  Avoid: The sync now backs off, and the tests pass.
  Prefer: The calendar sync was hitting the rate limit and dropping events. The
  sync now waits for the time the server asks for, and the four sync tests pass.

## Punctuation and layout

- **No em dashes, en dashes or middle dots.** Use a period or "and" between clauses,
  "to" in a range, and a comma, "and" or a new line in place of a middle dot.
  Avoid: The build is slow — it takes 5–10 minutes.
  Prefer: The build is slow. It takes 5 to 10 minutes.
- **Keep colons for lists and labels.** A colon may come before a list. A colon may
  also follow a short label in an update, a brief, a status note or a PR
  description, e.g., "Summary:" or "Next steps:". Don't use a colon in ordinary
  prose to tie two clauses together or to build up to a point.
  Avoid: The answer is simple: the cache was stale.
  Prefer: The cache was stale.
- **Use straight quotes.** The ASCII `"` is the only double quote mark to use.
- **Format simply.** Headings use sentence case, and bold is never decoration.
  Avoid: ## Setting Up The Database
  Prefer: ## Setting up the database
- **Use lists with restraint.** Three or four points is the limit, so nest the
  rest under group names. Essays should rarely use lists or tables.
  Prefer:
  - Done
    - Export button
    - Login fix
  - Open
    - Slow search on large projects

## Patterns to leave out

- **False actors.** Don't write as if an object decides or transforms on its own
  when a person or a process does the work. Simple factual verbs are fine, e.g.,
  "The API returns a list" or "The script deletes the file". Use a person or a
  process as the subject when that reads more clearly.
  Avoid: The data turns into insights once the export completes.
  Prefer: You can read the charts when the export completes.
- **Comparisons and imagery.** Don't explain by likeness or by metaphor. Say
  what the thing does, in words that mean only that.
  Avoid: The router acts as a traffic cop for requests.
  Prefer: The router reads the path and sends each request to one handler.
- **"Not just X, it is Y" and "not only X, but Y".** Give the plain description. You may
  refuse a claim or correct a claim, and you may quote a short phrase in order to
  replace the phrase with a fact.
  Avoid: It is not only a logger, it is an observability suite.
  Prefer: It writes logs and draws charts from them.
- **Stacks of rhetorical questions.** State the open problem directly.
  Avoid: Will people trust the score? Will they act on it?
  Prefer: We don't know yet if people trust the score or if they act on it.
- **Loose "this", "that", "these" and "those".** Name the noun instead. Don't begin
  a sentence with a demonstrative pronoun, and keep demonstratives out of the first
  sentence of a paragraph.
  Avoid: That fixes it for the next run.
  Prefer: The new default fixes the timeout on the next run.
- **Openings that count.** Don't announce how many points will follow, e.g., "Two
  risks." or "Three things to know." Start with the first point. Use a bullet list
  when you must present many points.
  Avoid: Two risks. First, the key can expire. Second, the quota can run out.
  Prefer: The key can expire, and the run then fails. The quota can also run out.

## The deslopify command

`/plain-writing deslopify` means that you rewrite the last agent reply, or the text
that follows the command. Write for a sharp executive or engineer who knows nothing
about the project, and return the rewrite with nothing around it.

Put the main conclusion first. After the conclusion, give the background and how
the thing works, in a logical order. Keep the technical details the reader needs,
use established terms in place of new ones, and define any term the reader may not
know. All the rules above apply.
