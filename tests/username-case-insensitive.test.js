const fs = require('fs');
const path = require('path');
const assert = require('assert');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260914000001_case_insensitive_usernames.sql'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');

assert.match(migration, /CREATE UNIQUE INDEX profiles_username_lower_unique\s+ON public\.profiles \(\(lower\(username\)\)\)/i,
  'database must arbitrate concurrent case-insensitive collisions');
assert.match(migration, /WHERE lower\(username\) = lower\(check_username\)/i,
  'availability RPC must use the same normalization as the unique index');
assert.match(migration, /VALUES \(NEW\.id, COALESCE\(desired_name, fallback_name\), 'free'\)/i,
  'signup trigger must preserve requested capitalization and use fallback only when no username was requested');
assert.doesNotMatch(migration, /UPDATE\s+public\.profiles/i,
  'migration must never rename an existing account');
assert.match(app, /error\.code === '23505' \? 'That username is already taken\.'/,
  'profile rename must turn a database uniqueness rejection into a clear message');
assert.match(app, /That username is already being used\. Try another\./,
  'signup availability rejection must remain clear');

console.log('6 case-insensitive username safeguards checked');
