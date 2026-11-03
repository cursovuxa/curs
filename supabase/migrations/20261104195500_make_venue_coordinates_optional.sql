alter table public.venues
  alter column latitude drop not null,
  alter column longitude drop not null;
