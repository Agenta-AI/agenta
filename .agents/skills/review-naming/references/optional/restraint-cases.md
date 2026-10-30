# Extra restraint cases (optional)

Load when you are unsure whether a structural pattern deserves a finding. Each case gives the
judgment we expect.

1. **One format, parsed twice.** Two modules each decode the same cookie value in their own way.
   Expected: a finding (one decision, one owner) when changing the format means editing both.
2. **A long function with one job.** A 150-line function runs one job from top to bottom.
   Expected: no finding. Length proves nothing here.
3. **Deleting a row that is already gone.** The route answers success and the row is absent
   afterwards, which is what the caller wanted. Expected: no finding. An answer of success to a
   caller without permission would be a finding.
4. **A thin wrapper with one check.** The wrapper checks a quota and then calls the inner method.
   Expected: keep it.
5. **Only a diagram to review.** Nothing else exists yet. Expected: findings about the names and
   boundaries in the picture, labeled as design risks, with no statements about code.
6. **A name that hides repeats.** A method called `post_one` tries three times inside. Expected:
   a finding on the name and on what the method promises.
7. **Two rules that happen to look alike.** Slugs and email addresses both get lowercased today.
   Should one helper serve both? Expected: no. Each can change on its own later.
8. **Nothing wrong.** Expected: "No findings." and a short "What to keep".
