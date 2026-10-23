SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r') AS public_table_count,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relrowsecurity AND c.relforcerowsecurity) AS forced_rls_table_count,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
         AND table_name = 'glucose_records' AND column_name = 'meal_slot') AS meal_slot_exists,
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'delete_my_account') AS account_delete_function,
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'save_meal_record') AS meal_save_function,
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'save_meal_record'
           AND p.prosrc LIKE '%PT409%') AS latest_meal_conflict_fix,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_count,
  (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.glucose_records')
   AND conname IN ('glucose_meal_slot_check', 'glucose_import_pair_check')) AS meal_constraints;
