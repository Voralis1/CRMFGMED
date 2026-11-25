-- =============================================================================
-- RETOUR ARRIÈRE de roles_permissions_garde.sql — 03/11/2026
-- =============================================================================
-- Remet l'état lu en production le 03/11 :
--   · role_permissions : les trois politiques d'écriture (super admin), et
--     insert/update/delete/truncate pour authenticated ;
--   · aucun trigger sur roles, role_permissions, permissions ;
--   · plus de remplacer_permissions_role / role_super_admin.
-- Ne retire AUCUNE permission à aucun rôle.
-- ⚠ Rouvre les trous : l'ancienne page peut de nouveau vider un rôle, et
-- supprimer un rôle porté retire leurs droits à ses comptes sans un mot.
-- À relancer AVANT de remettre l'ancienne page si la nouvelle est déjà poussée
-- (la nouvelle appelle remplacer_permissions_role). Rejouable.
-- =============================================================================
begin;

drop trigger if exists trg_role_permissions_garde          on public.role_permissions;
drop trigger if exists trg_role_permissions_garde_truncate on public.role_permissions;
drop trigger if exists trg_permission_au_super_admin       on public.permissions;
drop trigger if exists trg_roles_garde                     on public.roles;
drop function if exists public.role_permissions_garde();
drop function if exists public.permission_au_super_admin();
drop function if exists public.roles_garde();
drop function if exists public.remplacer_permissions_role(uuid, text[]);
drop function if exists public.role_super_admin();

grant insert, update, delete, truncate on public.role_permissions to authenticated;

drop policy if exists ecriture_role_permissions_super_admin    on public.role_permissions;
drop policy if exists modification_role_permissions_super_admin on public.role_permissions;
drop policy if exists suppression_role_permissions_super_admin  on public.role_permissions;
create policy ecriture_role_permissions_super_admin on public.role_permissions
  for insert to authenticated with check (public.is_super_admin());
create policy modification_role_permissions_super_admin on public.role_permissions
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy suppression_role_permissions_super_admin on public.role_permissions
  for delete to authenticated using (public.is_super_admin());

commit;

select (select string_agg(cmd || ' ' || policyname, ', ' order by cmd) from pg_policies
         where schemaname = 'public' and tablename = 'role_permissions') as politiques,
       (select relacl::text from pg_class where oid = 'public.role_permissions'::regclass) as droits,
       (select count(*) from pg_trigger
         where tgrelid in ('public.role_permissions'::regclass, 'public.roles'::regclass, 'public.permissions'::regclass)
           and not tgisinternal) as triggers_restants;
