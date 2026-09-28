-- Prevent object-shadowing attacks in every existing SECURITY DEFINER
-- function. Several early migrations created privileged functions before
-- the project standardized on an explicit search_path.
--
-- This is catalog-driven so replaced functions and overloaded signatures
-- are covered without duplicating their argument lists here.
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public',
      fn.signature
    );
  END LOOP;
END;
$$;
