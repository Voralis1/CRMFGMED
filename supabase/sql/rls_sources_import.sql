-- =============================================================================
-- RLS de sources_import — 15/10/2026
-- À exécuter AVANT de pousser le retour de /sources-import dans le menu.
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
--
-- Le trou : la politique d'écriture ne demandait que `vendeur_id = auth.uid()`.
-- N'importe quel compte de l'entreprise — agent, livreur — pouvait donc créer
-- depuis la console une source à son nom, avec un jeton de son choix, et
-- pousser des leads dans l'entreprise. Aucune permission n'était vérifiée.
--
-- Après ce fichier :
--   lire     : responsables (admin, ceo, manager) + le vendeur pour SES sources
--   écrire   : admin, manager (gere_la_config) — toute l'entreprise
--              ou le titulaire de `gerer_mes_sources`, pour SES sources
--   vendeur  : une source ne peut désigner qu'un utilisateur de la même
--              entreprise (avant : n'importe quel compte, même d'ailleurs)
--
-- Pourquoi gere_la_config() et pas la permission `gerer_sources_import` pour
-- « toute l'entreprise » : en base, le rôle seller détient aujourd'hui
-- `gerer_sources_import` (vérifié le 15/10). S'y fier donnerait à chaque
-- vendeur les sources de tous les autres. Le ceo lit sans écrire, comme
-- partout ailleurs.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Deux fonctions d'aide (SECURITY DEFINER : user_roles et role_permissions
--    ont leur propre RLS, et une politique qui les lirait directement risque
--    la récursion)
-- -----------------------------------------------------------------------------

-- La permission est une ligne en base, pas un nom de rôle écrit en dur.
create or replace function public.a_la_permission(p_code text)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
  as $function$
  select exists (
    select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
     where ur.user_id = auth.uid()
       and rp.permission_code = p_code
  )
$function$;

-- Le vendeur désigné doit appartenir à l'entreprise de la source : sinon un
-- responsable pourrait attribuer des leads à un compte d'une autre société.
create or replace function public.utilisateur_du_tenant(p_user uuid, p_tenant uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
  as $function$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = p_user and ur.tenant_id = p_tenant
  )
$function$;

revoke execute on function public.a_la_permission(text)             from public, anon;
revoke execute on function public.utilisateur_du_tenant(uuid, uuid) from public, anon;
grant  execute on function public.a_la_permission(text)             to authenticated, service_role;
grant  execute on function public.utilisateur_du_tenant(uuid, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. On retire TOUTES les politiques existantes avant de recréer
--    (plusieurs politiques permissives s'additionnent : la plus large gagne)
-- -----------------------------------------------------------------------------
do $$ declare p record; begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'sources_import'
  loop execute format('drop policy %I on public.sources_import', p.policyname); end loop;
end $$;

alter table public.sources_import enable row level security;


-- -----------------------------------------------------------------------------
-- 3. Les politiques — `to authenticated` : anon n'a rien à faire ici
-- -----------------------------------------------------------------------------
create policy sources_select on public.sources_import
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (public.est_responsable() or vendeur_id = auth.uid()))
  );

create policy sources_insert on public.sources_import
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (vendeur_id is null or public.utilisateur_du_tenant(vendeur_id, tenant_id))
        and (public.gere_la_config()
             or (vendeur_id = auth.uid() and public.a_la_permission('gerer_mes_sources'))))
  );

-- using = quelles lignes on peut viser ; with check = ce qu'elles deviennent.
-- Les deux sont nécessaires : sans with check, un vendeur pourrait donner sa
-- source à quelqu'un d'autre.
create policy sources_update on public.sources_import
  for update to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (public.gere_la_config()
             or (vendeur_id = auth.uid() and public.a_la_permission('gerer_mes_sources'))))
  )
  with check (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (vendeur_id is null or public.utilisateur_du_tenant(vendeur_id, tenant_id))
        and (public.gere_la_config()
             or (vendeur_id = auth.uid() and public.a_la_permission('gerer_mes_sources'))))
  );

create policy sources_delete on public.sources_import
  for delete to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (public.gere_la_config()
             or (vendeur_id = auth.uid() and public.a_la_permission('gerer_mes_sources'))))
  );


-- -----------------------------------------------------------------------------
-- 4. Vérification (lecture seule)
-- Attendu : 4 lignes, toutes {authenticated}
-- -----------------------------------------------------------------------------
select policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public' and tablename = 'sources_import'
 order by cmd;
