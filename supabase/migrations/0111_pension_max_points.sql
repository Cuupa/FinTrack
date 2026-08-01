-- The retirement projection could turn one mistyped row into a fantasy.
--
-- A Renteninformation leads with a CUMULATIVE figure ("Sie haben bisher
-- 17,0322 Entgeltpunkte erworben"); the year-by-year split lives in the
-- Versicherungsverlauf, which nobody types in. So a user copied 17 into the
-- one row the page offered -- "points, year 2025" -- and `averageAnnualPoints`
-- read it as "17 points EVERY year", extrapolated it over the ~32 years left,
-- and reported a pension of roughly 20.000 EUR a month.
--
-- Two fixes, both here:
--   * `pension_reference.max_points` -- the most Entgeltpunkte one year of work
--     can possibly earn. The projection caps its per-year assumption with it,
--     so a cumulative total in the wrong field can no longer multiply. It is
--     REFERENCE DATA like the Rentenwert next to it, never a constant in the
--     finance layer.
--   * `pension_settings.totalPoints` / `.totalPointsYear` -- the cumulative
--     figure gets a field of its own, so the number the user actually holds in
--     their hand has somewhere correct to go. Per-year rows dated AFTER it add
--     on top, exactly as the next statement will count them.

-- Hoechstwert an Entgeltpunkten pro Jahr = Beitragsbemessungsgrenze (allgemeine
-- Rentenversicherung, West) / Durchschnittsentgelt desselben Jahres. The
-- legislator keeps the BBG at roughly twice the average wage, so the ratio sits
-- just about 2.0 every year and is structurally stable -- which is what makes
-- it usable as a plausibility cap rather than an exact entitlement figure.
alter table public.pension_reference add column if not exists max_points numeric;

update public.pension_reference set max_points = v.max_points
from (values
  (2018, 2.06),
  (2019, 2.07),
  (2020, 2.04),
  (2021, 2.05),
  (2022, 2.01),
  (2023, 2.03),
  (2024, 2.00),
  (2025, 1.91)
) as v(year, max_points)
where public.pension_reference.year = v.year
  and public.pension_reference.max_points is null;

-- Two more projection assumptions in the jsonb blob (see migration 0106 for why
-- it is a blob and not a table). Existing rows keep whatever they hold; the
-- reader (`normalizePensionSettings`) treats a missing key as null, so no
-- backfill is needed and none is done.
alter table public.profiles alter column pension_settings set default
  '{"birthYear":null,"retirementAge":null,"annualPoints":null,"targetMonthly":null,"totalPoints":null,"totalPointsYear":null}'::jsonb;

insert into public.schema_migrations (version) values ('0111_pension_max_points')
on conflict (version) do nothing;
