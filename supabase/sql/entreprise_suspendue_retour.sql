-- =============================================================================
-- RETOUR ARRIÈRE de entreprise_suspendue.sql — 12/11/2026
-- 1. retire D'ABORD le réglage PostgREST (sinon chaque requête du CRM appellerait
--    une fonction absente et échouerait) ; 2. retire la porte ; 3. remet
--    get_my_tenant_id() comme dans le schéma initial (lu le 12/11).
-- Après : une entreprise suspendue n'est de nouveau bloquée que dans les Edge
-- Functions. Rejouable.
-- =============================================================================
begin;
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
commit;

begin;
drop function if exists public.verifier_entreprise_active();
create or replace function public.get_my_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.user_roles where user_id = auth.uid() limit 1
$$;
comment on function public.get_my_tenant_id() is null;
do $$ begin
  raise notice 'entreprise_suspendue_retour.sql : porte retirée, get_my_tenant_id d''origine ; une entreprise suspendue n''est bloquée que dans les Edge Functions.';
end $$;
commit;

select (select rolconfig::text from pg_roles where rolname = 'authenticator') as reglage_authenticator;
