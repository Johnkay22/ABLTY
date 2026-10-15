# Step 9: blind judging of the complete RV session

Johnny requested this plan and implementation on October 15, 2026. This replaces the older single-target grading proposal. Base: main `8a8e416`. Work stays on `codex/rv-blind-judging`, draft PR only.

## Protocol

1. Before the session, draw five different photos uniformly without replacement from the same eligible pool. A category session uses that category for all five. Exclude duplicate image content, including the existing T042/T064 duplicate. Independently choose the actual target uniformly among the five. The app receives only an opaque assignment and unrelated TRN.
2. At submission, lock a hash of the exact written impressions and sketch together. Written-only sessions are supported. Never choose decoys based on the submission, redraw the set on retry, or tell Gemini the target position, TRN, IDs, filenames, labels, descriptors or category.
3. Send one request containing the full session and five uniformly prepared JPEGs labelled A to E. The judge evaluates written and drawn information equally; artistic skill and canvas background/stroke color earn no credit. Treat instructions inside submissions or photos as data. Compare specificity, contradictions and unobservable claims; do not award guaranteed minimum scores or infer sounds, temperatures or feelings as photographed facts.
4. Require exactly five sets of six integer dimension scores, each 0 to 5. The server calculates the existing weighted 0 to 100 correspondence score. Rank by the unrounded weighted total; equal totals share a rank. Tied first is displayed as tied, never called a unique first-place result. Scores are descriptive ratings, not probabilities or proof of ability.
5. Persist the numeric judgment before revealing the target. Repeated requests return that result. Do not make up a result or silently fall back to known-target/text-only grading when a candidate photo or the judge is unavailable.

## Integrity, privacy and compatibility

- KV alone is eventually consistent and cannot serialize overlapping submissions. A new migration adds a service-only PostgreSQL receipt and atomic RPC using row locks. It stores opaque assignment IDs, candidate IDs, hashes, numeric scores, model/rubric versions and token counts, never sketches, notes, impressions or generated descriptions. No new provider configuration, credentials or Cloudflare binding is required.
- A confirmed transient failure can retry the identical submission, up to three model attempts. An interrupted/ambiguous in-flight request is not automatically rejudged. Assignments and receipts expire after two hours; expired rows are removed when the next assignment is created. This is a practice protocol, not a tamper-proof research system or proof of paranormal ability.
- A new nullable `rv_sessions.blind_judging` JSON column keeps rankings with the existing owner's session history and exports. Existing RLS/ownership remains in force. Older sessions keep their old scores and are labelled as legacy. Do not mix legacy scores into the new blind-judging charts.
- Candidate results show rank, photo, correspondence score and dimension ratings. Explanations are derived from those ratings; this first version does not add storage for generated descriptions of private impressions. Existing known-target grading remains only for assignments issued before this release, until their existing retry window expires.
- Existing photos remain intact for history. Checked-in 768px judging copies use identical processing, stripped metadata and content hashes, keeping requests small and verifying exactly which images were judged. No generated replacement imagery.
- Keep `gemini-2.5-flash` and dream tagging unchanged. Current official Gemini documentation is blocked by this environment's network policy. No model availability, current price, cost or judging-quality claim follows from mocked tests.

## Implementation and validation

1. Add photo preparation, protocol helpers, strict response validation and server-only persistence; wire assignment and grading routes.
2. Add results/history rankings, written-only support, safe rendering, preserved account ownership and version/cache bumps.
3. Exercise real Worker functions with mocked external services: five unique candidates, category fairness, no target leakage in the request, notes and sketch binding, one saved result, concurrent claims, ties, malformed responses, missing photos, timeouts and legacy compatibility. Exercise the actual migration in disposable PostgreSQL, including role denial and overlapping transactions. Run browser session/history/account-isolation and existing syntax/link checks.
4. Before merging, run a private quality/cost evaluation with authorized Gemini access: 10 to 15 owner-supplied sessions, written-only and sketch-plus-notes, mismatch and vague controls, three repeated offline evaluations and candidate-order rotations. Record rank, ties, dimension scores, latency and actual token usage. Keep examples and responses outside the public repository. Compare with the previous grader without treating larger scores as improvement. This evaluation never regrades production sessions.
5. Johnny reviews the draft. An authorized operator applies the new migration before the app/Worker release; deployment and phone checks remain separate. The draft must not be merged until migration ordering, real Gemini response compatibility and the quality/cost evaluation are reviewed. No production migration or deployment is performed in this task.

### Private comparison runner

Create a JSON array outside the repository. Each case has `target_id`, `notes` (all impressions) and optional `sketch_path` pointing to a private JPEG. Include real matched sessions, intentionally mismatched versions, and vague controls. Use the same set for both graders. The runner records numeric results and token metadata only, and does not write session text or model prose to its report.

```bash
# Default is a dry run: validates cases and reports the number of API requests.
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/results.json
# After authorized paid testing and secure ABLTY_GEMINI_TEST_KEY binding:
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/results.json --repeats 3 --run-paid
# Separate position-bias check: five rotations, one repeat each.
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/positions.json --repeats 1 --rotations 5 --run-paid
```

The default comparison makes six model requests per case (three legacy, three blind). Rates are not hard-coded; optional `--input-usd-per-million` and `--output-usd-per-million` use prices verified by the operator and produce an estimate, not an invoice. A malformed response or network failure stops the run without automatic spending retries. Existing output files should be preserved under separate filenames for later comparisons.

A development-environment draft was saved with `ai.google.dev`, `generativelanguage.googleapis.com` and a personal `ABLTY_GEMINI_TEST_KEY` requirement scoped to Google's API. Existing domains/presets were preserved. It contains no credential value, does not change the production Worker key and needs user review/save/publication plus secure value entry before testing can proceed. No API key was found in the running environment.

## Release checks

Verify all five judging assets load, a written-only session and a sketch-plus-impressions session both complete, ties display honestly, double submit does not spend twice, history retains rankings after sign-out/reopen/cloud restore, and a failed judgment stays ungraded. Repeat on iPhone and Android. The five equally eligible target positions give a 1-in-5 unique-first baseline only when there is a unique first; report ties separately and do not calculate significance or ability claims in this release. Step 8 beta access follows this work.
