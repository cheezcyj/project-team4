SELECT
  (SELECT count(*) FROM public.food_catalog) AS foods,
  (SELECT count(*) FROM public.benefit_rules) AS benefits,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies,
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = to_regclass('public.glucose_records')
     AND conname IN ('glucose_meal_slot_check', 'glucose_import_pair_check')) AS meal_constraints;
