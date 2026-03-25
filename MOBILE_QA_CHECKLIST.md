# ABLTY Mobile QA Checklist

Use this checklist for every release candidate on a real phone (installed PWA, not only browser tab).

## Pre-check

- [ ] Device has network access
- [ ] App opens from home-screen icon
- [ ] You are signed into the intended test account(s)

## 1) Update flow

- [ ] Open app from home-screen icon
- [ ] Wait 20-30 seconds
- [ ] If an update is available, "Update available" banner appears
- [ ] Tap REFRESH and confirm app reloads cleanly

## 2) Auth and tier sanity

- [ ] Username shown correctly in Settings
- [ ] Tier shown correctly (guest/free/premium)
- [ ] Sign out then sign in again works
- [ ] Session state is correct after re-open

## 3) Core module smoke test

Run at least one session/trial in each:

- [ ] RV
- [ ] Zener
- [ ] Presentiment
- [ ] Photo Pair

## 4) Analytics log correctness

- [ ] All filter shows all recent entries
- [ ] RV filter shows only RV
- [ ] Zener filter shows only Zener
- [ ] Presentiment filter shows only Presentiment
- [ ] Photo Pair filter shows only Photo Pair
- [ ] Sort by Date works (newest first)
- [ ] Sort by Score works (high to low)

## 5) Persistence (critical)

- [ ] Force-close app
- [ ] Re-open app from home-screen icon
- [ ] All recent stats/log entries still present
- [ ] Repeat close/re-open one more time after a few minutes

## 6) Premium gating checks

- [ ] Premium account is not blocked by RV free daily limit
- [ ] Free account still respects free daily limits
- [ ] Upgrade CTA behavior is correct for free users

## 7) Install/onboarding copy

- [ ] Install screen title reads: "ABLTY INSTALLING"
- [ ] ABLTY icon appears under title
- [ ] Guidance text appears under icon and is readable

## Report template

Copy and fill this in one message:

- Update flow: Pass/Fail
- Auth/tier: Pass/Fail
- RV: Pass/Fail
- Zener: Pass/Fail
- Presentiment: Pass/Fail
- Photo Pair: Pass/Fail
- Filter correctness: Pass/Fail
- Sorting: Pass/Fail
- Persistence after reopen: Pass/Fail
- Premium gating: Pass/Fail
- Notes/screenshots:
