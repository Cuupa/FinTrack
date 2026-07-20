-- Feature flag for automatic stock-split detection (Yahoo Finance) + the
-- review-and-book flow on the asset detail page. Kill switch only, same
-- pattern as 0071/0046/0039: seeded enabled, no new tables.
insert into public.feature_flags (flag, description) values
  ('splitDetection', 'Automatic stock split detection + review on asset detail')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0073_split_detection_flag')
on conflict (version) do nothing;
