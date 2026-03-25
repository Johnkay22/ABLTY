# ABLTY Release Checklist

Use this checklist for every production release.

## 1) Pre-merge checks (branch / PR)

- [ ] `git status` is clean except intended files
- [ ] Feature fixes are committed with clear messages
- [ ] Branch pushed to remote
- [ ] PR opened/updated against `main`
- [ ] PR summary includes:
  - [ ] user-visible changes
  - [ ] persistence/auth impact
  - [ ] service worker/cache updates (if any)

## 2) Required technical checks

- [ ] JavaScript syntax check passes (`node --check` on extracted inline script)
- [ ] No duplicate core functions introduced (search for duplicates of critical handlers)
- [ ] Data persistence paths reviewed for:
  - [ ] local writes
  - [ ] pending queues
  - [ ] cloud hydration merge behavior
- [ ] Auth state reconciliation reviewed (`sb.auth.getSession`, local cache alignment)

## 3) Service worker / update flow

- [ ] If app shell changed, `sw.js` cache version bumped (`ablty-vX`)
- [ ] `registerSW()` verifies waiting worker path
- [ ] Update banner path tested at least once
- [ ] `applyUpdate()` path reloads cleanly

## 4) Merge and deploy

- [ ] PR merged into `main`
- [ ] GitHub Pages deployment completed
- [ ] Production URL reachable

## 5) Post-merge smoke test (phone)

- [ ] Open from home screen icon
- [ ] Confirm app loads current build
- [ ] Run mobile QA checklist (`MOBILE_QA_CHECKLIST.md`)

## 6) Rollback plan (if release fails)

- [ ] Identify last known-good commit in `main`
- [ ] Revert bad commit(s) in new PR (no force-push to `main`)
- [ ] Merge revert PR
- [ ] Re-test smoke checks

## 7) Release notes hygiene

- [ ] Update `CHANGELOG.md`
- [ ] Update `KNOWN_ISSUES.md` if new known issue exists

