-- Vorabpauschale estimator (COMPETITION.md F6).
--
-- The Basiszins used to compute the Vorabpauschale is published once a year by
-- the Bundesbank/BMF and is pure reference data — DB-seeded, world-readable,
-- owner-written (never hardcoded in app code). The estimate itself is derived
-- client-side in the tax view; nothing per-user is stored.

create table if not exists public.basiszins (
  year int primary key,
  -- Decimal fraction (0.0255 = 2.55%). Negative years yield no Vorabpauschale.
  rate numeric not null,
  note text
);

alter table public.basiszins enable row level security;

drop policy if exists "basiszins readable" on public.basiszins;
create policy "basiszins readable" on public.basiszins for select using (true);

-- Published BMF Basiszins values. 2021 and 2022 were negative, so no
-- Vorabpauschale accrued those years. The owner adds new years as the BMF
-- publishes them (typically each January).
insert into public.basiszins (year, rate, note) values
  (2018, 0.0087, 'BMF Basiszins 0.87%'),
  (2019, 0.0052, 'BMF Basiszins 0.52%'),
  (2020, 0.0007, 'BMF Basiszins 0.07%'),
  (2021, -0.0045, 'BMF Basiszins -0.45% (negative, no Vorabpauschale)'),
  (2022, -0.0005, 'BMF Basiszins -0.05% (negative, no Vorabpauschale)'),
  (2023, 0.0255, 'BMF Basiszins 2.55%'),
  (2024, 0.0229, 'BMF Basiszins 2.29%'),
  (2025, 0.0253, 'BMF Basiszins 2.53%')
on conflict (year) do nothing;

-- Kill switch for the estimate (the manual Vorabpauschale entry is untouched
-- by it), seeded enabled, same pattern as 0071/0073.
insert into public.feature_flags (flag, description) values
  ('vorabEstimate', 'Vorabpauschale estimate on the annual tax report')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0074_vorabpauschale')
on conflict (version) do nothing;
