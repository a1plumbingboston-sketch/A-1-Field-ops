-- Align both estimating profiles with A-1's current $200-$250 customer
-- billing range. The owner can still edit either range in FieldOps settings.
insert into public.fieldops_labor_rate_settings(profile,min_rate,max_rate,updated_at,updated_by)
values
 ('service',200,250,now(),'2026-09 estimator configuration'),
 ('construction',200,250,now(),'2026-09 estimator configuration')
on conflict(profile) do update set
 min_rate=excluded.min_rate,
 max_rate=excluded.max_rate,
 updated_at=excluded.updated_at,
 updated_by=excluded.updated_by;
