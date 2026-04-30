ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version        text,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_version      text;
