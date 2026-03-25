# Changelog

All notable changes to ABLTY are documented here.

## 2026-03-22

### Fixed
- Analytics log filtering now correctly separates Presentiment and Photo Pair entries.
- Added log sorting options in Analytics (`Date`, `Score`).
- Improved analytics persistence across app restarts with local pending queues and cloud merge behavior.
- Hardened service worker update detection and update-banner reliability for installed app users.
- Fixed premium RV access so premium users are not blocked by the free daily RV limit.

### Changed
- Install confirmation screen copy now reads `ABLTY INSTALLING` with home-screen launch guidance.
- Service worker cache version bumped multiple times during rollout hardening to force client refresh of stale installs.

### Operational
- Added release hardening docs:
  - `MOBILE_QA_CHECKLIST.md`
  - `RELEASE_CHECKLIST.md`
  - `KNOWN_ISSUES.md`
