ALTER TABLE public.event_program
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'activity',
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 30;

UPDATE public.event_program AS child
SET item_type = 'section'
WHERE EXISTS (
  SELECT 1 FROM public.event_program AS nested
  WHERE nested.parent_section_id = child.id
);

UPDATE public.event_program
SET duration_minutes = GREATEST(
  1,
  CASE
    WHEN end_time >= start_time
      THEN CEIL(EXTRACT(EPOCH FROM (end_time - start_time)) / 60.0)::integer
    ELSE CEIL(EXTRACT(EPOCH FROM (end_time - start_time)) / 60.0)::integer + 1440
  END
)
WHERE start_time IS NOT NULL AND end_time IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_program_id_event_id_key
  ON public.event_program (id, event_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_program_item_type_check') THEN
    ALTER TABLE public.event_program
      ADD CONSTRAINT event_program_item_type_check CHECK (item_type IN ('section', 'activity'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_program_duration_positive_check') THEN
    ALTER TABLE public.event_program
      ADD CONSTRAINT event_program_duration_positive_check CHECK (duration_minutes BETWEEN 1 AND 1440);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_program_parent_same_event_fkey') THEN
    ALTER TABLE public.event_program
      ADD CONSTRAINT event_program_parent_same_event_fkey
      FOREIGN KEY (parent_section_id, event_id)
      REFERENCES public.event_program (id, event_id) ON DELETE CASCADE;
  END IF;
END $$;
