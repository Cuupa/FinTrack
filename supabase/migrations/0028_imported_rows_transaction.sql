-- Migration: link imported_rows fingerprints to the transaction they created
-- or merged into. A fingerprint only means anything in relation to the
-- transaction it produced: deleting that transaction (directly, via asset
-- delete, or via portfolio delete, all of which cascade onto transactions)
-- should cascade away the fingerprint too, otherwise a re-imported CSV wrongly
-- shows the row as "already imported" even though the transaction is gone.
-- Nullable because rows recorded before this migration have no link. Idempotent.

alter table public.imported_rows
  add column if not exists transaction_id uuid references public.transactions (id) on delete cascade;

insert into public.schema_migrations (version) values ('0028_imported_rows_transaction')
on conflict (version) do nothing;
