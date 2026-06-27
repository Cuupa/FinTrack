-- Migration: per-holding trading currency on assets. A user can hold a shared
-- instrument (e.g. Google, USD) in their own currency (e.g. EUR) without
-- mutating the global instrument — valuation converts via FX. Idempotent.

alter table public.assets add column if not exists currency text;
