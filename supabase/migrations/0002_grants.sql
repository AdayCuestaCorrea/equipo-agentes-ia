-- Explicit privileges. The project does not grant table access to the API roles by default
-- (seen live: "permission denied for table runs" with the service role), and 0001 revoked
-- EXECUTE on the lease functions from PUBLIC without granting it to service_role.

grant usage on schema public to anon, authenticated, service_role;

-- Server (service role): full access; RLS is bypassed for this role.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.claim_run(uuid, int) to service_role;
grant execute on function public.release_run(uuid) to service_role;

-- Browser (anon / signed-in): read-only, further limited by the RLS policies in 0001.
grant select on public.runs, public.tasks, public.agent_messages, public.agent_events,
                public.file_versions, public.test_reports
  to anon, authenticated;
