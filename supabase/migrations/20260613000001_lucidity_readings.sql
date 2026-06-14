-- lucidity_readings: short-form original reading pieces shown at WBTB Step 4.
-- RLS restricts SELECT to premium users only — this is the real gate, not client checks.
-- Free and guest users get [] with no error; the step renders cleanly with just Continue.
-- wbtb_sessions.reading_id_shown FK (noted in 20260612000001 as "lands in PR D-5") added here.

CREATE TABLE IF NOT EXISTS public.lucidity_readings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  author                text,
  source_citation       text,
  body_text             text NOT NULL,
  category              text,
  est_read_time_seconds int
);

ALTER TABLE public.lucidity_readings ENABLE ROW LEVEL SECURITY;

-- Premium-only SELECT. EXISTS subquery against profiles (id = auth.uid() per existing schema).
DROP POLICY IF EXISTS "sec_lucidity_readings_premium_select" ON public.lucidity_readings;
CREATE POLICY "sec_lucidity_readings_premium_select" ON public.lucidity_readings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND tier = 'premium'
    )
  );

-- FK constraint from wbtb_sessions.reading_id_shown to lucidity_readings.id.
-- Idempotent: wrapped in DO block to skip if already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'wbtb_sessions_reading_id_fk'
      AND table_name = 'wbtb_sessions'
  ) THEN
    ALTER TABLE public.wbtb_sessions
      ADD CONSTRAINT wbtb_sessions_reading_id_fk
      FOREIGN KEY (reading_id_shown) REFERENCES public.lucidity_readings(id);
  END IF;
END $$;

-- Seed: 3 placeholder pieces. Real content added via Supabase dashboard — no code deploy needed.
INSERT INTO public.lucidity_readings (title, author, body_text, category, est_read_time_seconds) VALUES
(
  'The Moment You''re Looking For',
  'ABLTY',
  'There''s a specific moment WBTB practitioners describe as the threshold — it happens as you drift back toward sleep and your thoughts begin to untether from logic. Sentences that made sense a moment ago now curve into the impossible. This loosening is not failure. It''s the signal.

MILD works by seeding that threshold with intention. As your waking mind hands off to the dreaming one, the intention you''ve been holding doesn''t disappear. It travels with you. The recognizing isn''t a skill you have to develop. It''s more like a meeting you''ve already scheduled.

Your job right now is simple: hold the intention clearly, let sleep come, and trust that something in you is already waiting on the other side of that threshold to keep the appointment.',
  'mild',
  90
),
(
  'Second Sleep',
  'ABLTY',
  'When you sleep through the night, your REM cycles lengthen progressively toward morning. The dreams in your later sleep cycles are physiologically different from the ones earlier in the night — longer, more vivid, more narrative, with greater emotional texture.

Wake-back-to-bed interrupts this trajectory deliberately. When you return to sleep after a period of waking, you''re not resetting. You''re re-entering a system that has already warmed up. The neurochemistry that makes REM sleep lucid-friendly is still primed. You are jumping the queue.

This is why WBTB has the highest success rates of any lucid dreaming technique among practiced dreamers. Not because of willpower. Because of biology. The architecture is already in your favor.',
  'biology',
  80
),
(
  'The Signal in the Strange',
  'ABLTY',
  'Dream signs aren''t always dramatic. Most practitioners spend months looking for floating objects and impossible physics before realizing their actual signs are quieter — a specific person who keeps appearing, a building that feels familiar but shifts its layout each time, a persistent emotional tone without a source.

The work you just did — checking your hands, reading a word, testing the impossible — is training a different kind of attention. Not the attention that looks for danger or problem-solves, but the attention that notices when reality is slightly off-register.

Each time you perform a reality check while awake and genuinely ask the question, you are loading a habit into the part of your mind that will still be running when the rest of you is asleep.',
  'reality-check',
  85
);
