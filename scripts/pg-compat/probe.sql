-- For an approved target where the probe RPC is absent. Do not replace an existing function.
BEGIN;
CREATE FUNCTION public.rehub_pg_compat_check() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  RETURN 1;
END;
$$;
REVOKE ALL ON FUNCTION public.rehub_pg_compat_check() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rehub_pg_compat_check() TO service_role;
COMMIT;
