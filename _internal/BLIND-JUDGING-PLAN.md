# Step 9: blind judging of the complete RV session

Draft review: [PR #149](https://github.com/Johnkay22/ABLTY/pull/149). Do not merge until the evaluation and migration prerequisites below are complete.

Johnny requested this plan and implementation on October 15, 2026. This replaces the older single-target grading proposal. Base: main `8a8e416`. Work stays on `codex/rv-blind-judging`, draft PR only.

October 16 follow-up: Johnny approved sensory scoring, permanent finished receipts and private thinking/model comparisons. Proposed app version `2026.10.16.1`, cache `ablty-v100`. The migration remains an unapplied draft file; production model/settings are unchanged.

## Protocol

1. Before the session, draw five different photos uniformly without replacement from the same eligible pool. A category session uses that category for all five. Exclude duplicate image content, including the existing T042/T064 duplicate. Independently choose the actual target uniformly among the five. The app receives only an opaque assignment and unrelated TRN.
2. At submission, lock a hash of the exact written impressions and sketch together. Written-only sessions are supported. Never choose decoys based on the submission, redraw the set on retry, or tell Gemini the target position, TRN, IDs, filenames, labels, descriptors or category.
3. Send one request containing the full session and five uniformly prepared JPEGs labelled A to E. The judge evaluates written and drawn information equally; artistic skill and canvas background/stroke color earn no credit. Treat instructions inside submissions or photos as untrusted data. Sensory impressions count only when the photo clearly and directly implies them, such as cold with snow or ice, loud sound with breaking surf, or heat with fire. Merely possible sensations receive no credit. Vague or near-universal words such as "cool" or "quiet" alone receive at most 1. Specific contradictions lower the rating. Object names receive no special bonus, and repeated claims or synonyms receive no double credit, including across visible texture, felt texture and atmosphere.
4. Require exactly five sets of seven integer dimension scores, each 0 to 5. Rubric `seven-dimensions-v1` uses weights 3 for form, 2.5 for space, 1.5 for visible texture, 1 for emotional tone, 1.5 for movement, 0.5 for color/light and 1 for `sensory_impression` (temperature, sound, smell, felt texture and ambience). The server calculates `round(weighted total / 55 * 100)`, keeping the maximum at 100. Rank by the unrounded weighted total; equal totals share a rank. Tied first is displayed as tied, never called a unique first-place result. Scores are descriptive ratings, not probabilities or proof of ability.
5. Persist the numeric judgment before revealing the target. Repeated requests return that result. Do not make up a result or silently fall back to known-target/text-only grading when a candidate photo or the judge is unavailable.

## Integrity, privacy and compatibility

- KV alone is eventually consistent and cannot serialize overlapping submissions. A new migration adds a service-only PostgreSQL receipt and atomic RPC using row locks. It stores opaque assignment IDs, candidate IDs, hashes, numeric scores, model/rubric versions, token counts, `created_at` and `finished_at`, never user/account IDs, sketches, notes, impressions or generated descriptions. Completion timestamps are set when the result is committed and remain unchanged on replay. No new provider configuration, credentials or Cloudflare binding is required.
- A confirmed transient failure can retry the identical submission, up to three model attempts. An interrupted/ambiguous in-flight request is not automatically rejudged. The claim window remains two hours after assignment, and the first submission starts the existing two-hour retry window; later retries do not extend it. Finished receipts in state `done` are retained permanently, including after that window closes. They cannot be replayed after expiry through the judging RPC. Only expired unfinished receipts are removed when the next assignment is created. The cleanup index covers only unfinished receipts. Rollback preserves finished receipts and existing history. This supplies a durable numeric server record for later statistics work; it does not implement a public stats page or leaderboard. This is a practice protocol, not a tamper-proof research system or proof of paranormal ability.
- A new nullable `rv_sessions.blind_judging` JSON column keeps rankings with the existing owner's session history and exports. Existing RLS/ownership remains in force. Older sessions keep their old scores and are labelled as legacy. Do not mix legacy scores into the new blind-judging charts.
- Candidate results show rank, photo, correspondence score and dimension ratings. Explanations are derived from those ratings; this first version does not add storage for generated descriptions of private impressions. Existing known-target grading remains only for assignments issued before this release, until their existing retry window expires.
- Saved `six-dimensions-v1` judgments retain their six ratings and original denominator of 50, scores and ranks. They are not regraded or assigned a missing sensory score of zero. Results/history show sensory ratings only for the new rubric, and sensory averages include only sessions with that rating. Existing chart grouping by blind versus legacy method is unchanged.
- Existing photos remain intact for history. Checked-in 768px judging copies use identical processing, stripped metadata and content hashes, keeping requests small and verifying exactly which images were judged. No generated replacement imagery.
- Keep production `gemini-2.5-flash`, `thinkingBudget: 0` and dream tagging unchanged. Official Gemini documentation was reachable on October 16. The private evaluator can compare 2.5 Flash and 3.8 Flash; this does not switch the production model. No account-specific model availability, measured cost or judging-quality claim follows from documentation or mocked tests.

## Scores shown to other users

`rv_sessions.score` is written by the user's device and must never be trusted for anything shown to other users. Any cross-user ranking must recompute the score from `rv_blind_receipts.score_matrix` and confirm the receipt's `submission_hash` matches that session's saved sketch and notes.

- `rv_sessions.blind_receipt_id` links a graded blind session to its receipt. A partial unique index lets one receipt back only one session. It is null for older, legacy, failed and six-dimension sessions saved before the link existed, and for a second copy that received a replayed receipt; those stay out of any cross-user ranking.
- The hash is SHA-256 over the UTF-8 bytes of the JSON array `["blind-five-v1",sketch,notes]` with no spaces. `sketch` is the base64 JPEG without its `data:image/...;base64,` prefix and `notes` is the joined impressions text; an empty value hashes as `""`. The database stores the sketch with that prefix and stores empty notes or sketch as null, so strip the prefix and treat null as `""` before hashing. Also confirm the receipt is finished and its TRN matches the session. A session whose hash does not match is excluded, never trusted.

## Implementation and validation

1. Add photo preparation, protocol helpers, strict response validation and server-only persistence; wire assignment and grading routes.
2. Add results/history rankings, written-only support, safe rendering, preserved account ownership and version/cache bumps.
3. Exercise real Worker functions with mocked external services: five unique candidates, category fairness, no target leakage in the request, notes and sketch binding, one saved result, concurrent claims, ties, malformed responses, missing photos, timeouts and legacy compatibility. Exercise the actual migration in disposable PostgreSQL, including role denial and overlapping transactions. Run browser session/history/account-isolation and existing syntax/link checks.
4. Before merging, run a private quality/cost evaluation with authorized Gemini access: 10 to 15 owner-supplied sessions, written-only and sketch-plus-notes, mismatch and vague controls, three repeated offline evaluations and candidate-order rotations. Record rank, ties, dimension scores, latency and actual token usage. Keep examples and responses outside the public repository. Compare with the previous grader without treating larger scores as improvement. This evaluation never regrades production sessions.
5. Johnny reviews the draft. An authorized operator applies the new migration before the app/Worker release; deployment and phone checks remain separate. The draft must not be merged until migration ordering, real Gemini response compatibility and the quality/cost evaluation are reviewed. No production migration or deployment is performed in this task.

### Private comparison runner

Create a JSON array outside the repository. Each case has `target_id`, `notes` (all impressions) and optional `sketch_path` pointing to a private JPEG. Include real matched sessions, intentionally mismatched versions, and vague controls. The runner records scores, blind ranks/ties, all candidate scores/ranks, dimension ratings, model, actual input/output/thinking tokens, elapsed milliseconds and request settings. Legacy grading has no five-photo rank, so its rank is null. Missing usage stays unknown. No session text, images, thought text or model prose is written to the report.

```bash
# Default is a dry run: validates cases and reports the number of API requests.
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/results.json
# After authorized paid testing and secure ABLTY_GEMINI_TEST_KEY binding:
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/results.json --repeats 3 --run-paid
# Gemini 2.5 with thinking enabled, private evaluation only:
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/thinking.json --model gemini-2.5-flash --thinking-budget 1024 --run-paid
# Compare both models with identical cases, candidate sets, order and rotations:
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/models.json --model gemini-2.5-flash,gemini-3.8-flash --thinking-budget 0 --thinking-level medium --run-paid
# A separate Gemini 3.8 run with lower thinking effort, not thinking disabled:
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/low.json --model gemini-3.8-flash --thinking-level low --run-paid
# Separate position-bias check: five rotations, one repeat each.
node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/positions.json --repeats 1 --rotations 5 --run-paid
```

The default remains Gemini 2.5 Flash with thinking budget 0, three repeats and one candidate order, making six requests per case (three legacy, three blind). Selecting both models doubles that to twelve. The same prepared candidates are reused across models in one run. Separate invocations draw fresh candidates, so use the combined-model command for a controlled model comparison; separate thinking-budget runs are exploratory unless their recorded candidate sets/order match. Gemini 2.5's `--thinking-budget` accepts nonnegative integers through 24576. Gemini 3.8 uses `--thinking-level low|medium|high`, default medium, without a numeric budget. Incompatible options are rejected before any call.

The private evaluator reserves answer tokens in addition to a 2.5 thinking budget. For 3.8 it allows the documented maximum of 65,536 combined thinking/output tokens, removes sampling settings and records the actual usage. This is a ceiling, not a promised cost. Higher thinking may increase cost and latency. Requests have a three-minute timeout and no automatic retries. A malformed response or provider failure stops the run, marks the report stopped and preserves completed numeric runs. Reports use owner-only file permissions and refuse to overwrite an existing file. Rates are not hard-coded; optional `--input-usd-per-million` and `--output-usd-per-million` accept operator-verified prices only for a single-model run, avoiding the same price being applied to different models. Estimates require measured usage and are not invoices.

### Official API review, October 16

- [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations): 2.5 access is limited to accounts that actively used it; there is no announced shutdown date. Google recommends 3.8 Flash or 3.5 Flash-Lite for new projects. Verify access with the authorized test account before paid comparisons.
- [Gemini 3.8 migration guide](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8) and [model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash): use low, medium (default) or high thinking; minimal is rejected. Remove deprecated sampling settings such as temperature. The model supports image inputs and structured output. The evaluator keeps the same anonymous images, rubric and JSON schema across models.
- [generateContent REST reference](https://ai.google.dev/api/generate-content#ThinkingConfig): the existing REST endpoint supports `generationConfig.thinkingConfig.thinkingBudget` for the older model and `thinkingLevel` for Gemini 3. The evaluator sends only the applicable control. These are independent, single-turn requests without tools or conversation replay, so function-response and multi-turn signature migration rules do not require new flows here. It never persists returned thought text or signatures.
- The generic latest-model page now describes a different model. The implementation follows the specific 3.8 guide rather than substituting another model or API. The newer Interactions API is not introduced in this task.

A development-environment draft was previously saved with `ai.google.dev`, `generativelanguage.googleapis.com` and a personal `ABLTY_GEMINI_TEST_KEY` requirement scoped to Google's API. No environment or provider settings were changed in this follow-up. Official documentation access now works; that does not establish access to either model. Paid testing still requires an owner-authorized test key supplied securely and owner-approved private cases. No paid Gemini requests were made in this follow-up.

## Release checks

Verify all five judging assets load, a written-only session and a sketch-plus-impressions session both complete, ties display honestly, double submit does not spend twice, history retains rankings after sign-out/reopen/cloud restore, and a failed judgment stays ungraded. Repeat on iPhone and Android. The five equally eligible target positions give a 1-in-5 unique-first baseline only when there is a unique first; report ties separately and do not calculate significance or ability claims in this release. Step 8 beta access follows this work.
