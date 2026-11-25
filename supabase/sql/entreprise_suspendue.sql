-- =============================================================================
-- T11 — UNE ENTREPRISE SUSPENDUE EST FERMÉE PARTOUT, PAS SEULEMENT DANS LES EDGE FUNCTIONS — 12/11/2026
-- NE MODIFIE AUCUNE DONNÉE. Change get_my_tenant_id() et ajoute une porte avant chaque requête.
-- =============================================================================
--
-- AVANT (lu en prod le 12/11) : seules les Edge Functions lisent tenants.statut
-- (_shared/auth.ts : « Entreprise suspendue ou introuvable »). Le navigateur parle
-- à la base en direct (PostgREST) : un compte d'une entreprise SUSPENDUE lisait et
-- écrivait encore tout ce que ses droits permettent — commandes, produits, relevés…
--
-- APRÈS — deux portes, le super admin n'est jamais bloqué :
--   1. get_my_tenant_id() ne rend RIEN pour une entreprise dont le statut n'est pas
--      « actif ». Presque toutes les règles (RLS des tables, images du stockage,
--      fonctions des écrans) comparent à get_my_tenant_id() : elles se ferment
--      d'elles-mêmes.
--   2. verifier_entreprise_active(), appelée par PostgREST AVANT CHAQUE requête du
--      navigateur (pgrst.db_pre_request) : un compte d'une entreprise suspendue
--      reçoit « Entreprise suspendue » (403) sur tout — y compris les quelques
--      fonctions qui ne regardent que « est-ce à moi ? » (proposer_sku,
--      source_m_appartient…) et toute fonction future.
--   Même règle que les Edge Functions : tout statut autre que « actif » ferme
--   (aujourd'hui l'écran Super admin → Entreprises pose « suspendu »).
--   Réactiver l'entreprise rouvre tout, tout de suite. Aucune donnée n'est touchée.
--
--   §1 get_my_tenant_id ; §2 la porte avant chaque requête ; §3 contrôles ;
--   §4 répétition (annulée) : l'entreprise de test suspendue le temps d'un essai.
--
-- RETOUR ARRIÈRE : entreprise_suspendue_retour.sql (copie sur le Bureau) — il
-- retire D'ABORD le réglage PostgREST, PUIS la fonction (l'inverse couperait
-- toutes les requêtes du CRM).
-- =============================================================================

begin;

-- §1 get_my_tenant_id : rien pour une entreprise suspendue ---------------------------
-- Corps d'avant (schéma initial, lu le 12/11) :
--   select tenant_id from public.user_roles where user_id = auth.uid() limit 1
-- is_super_admin() ne lit pas get_my_tenant_id : pas de boucle.
create or replace function public.get_my_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ur.tenant_id
    from public.user_roles ur
    left join public.tenants t on t.id = ur.tenant_id
   where ur.user_id = auth.uid()
     and (coalesce(t.statut, 'actif') = 'actif' or public.is_super_admin())
   limit 1
$$;
comment on function public.get_my_tenant_id() is 'fichier: entreprise_suspendue.sql';

-- §2 La porte avant chaque requête du navigateur ---------------------------------------
create or replace function public.verifier_entreprise_active()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  -- pas connecté (anon), service role, éditeur SQL : rien à vérifier ici
  if v_uid is null then
    return;
  end if;
  if exists (select 1 from public.user_roles ur
               join public.tenants t on t.id = ur.tenant_id
              where ur.user_id = v_uid and coalesce(t.statut, 'actif') <> 'actif')
     and not public.is_super_admin() then
    raise exception 'Entreprise suspendue : l''accès au CRM est fermé. Contactez FGMED.'
      using errcode = '42501', hint = 'entreprise_suspendue';
  end if;
end;
$$;
comment on function public.verifier_entreprise_active() is 'fichier: entreprise_suspendue.sql — pgrst.db_pre_request';
revoke all on function public.verifier_entreprise_active() from public, anon;
grant execute on function public.verifier_entreprise_active() to authenticated, service_role;

-- PostgREST l'appelle avant chaque requête (relu à chaud par NOTIFY, au commit).
alter role authenticator set pgrst.db_pre_request to 'public.verifier_entreprise_active';
notify pgrst, 'reload config';

-- §3 Contrôles ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator'
                  and rolconfig::text like '%pgrst.db_pre_request=public.verifier_entreprise_active%') then
    raise exception 'entreprise_suspendue.sql : le réglage pgrst.db_pre_request n''est pas posé. Rien n''est installé.';
  end if;
  if has_function_privilege('anon', 'public.verifier_entreprise_active()', 'execute') then
    raise exception 'entreprise_suspendue.sql : la porte est ouverte à anon. Rien n''est installé.';
  end if;
end $$;

-- §4 Répétition (annulée) : l'entreprise de test suspendue le temps d'un essai ------------
do $$
declare
  c_test constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_mgr uuid; v_sa uuid; n bigint; v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  if not exists (select 1 from public.tenants where id = c_test) then
    raise notice 'entreprise_suspendue.sql : pas d''entreprise de test — répétition sautée.'; return;
  end if;
  select u.user_id into v_mgr from public.user_roles u
   where u.tenant_id = c_test and lower(u.role) = 'manager' limit 1;
  select u.user_id into v_sa from public.user_roles u left join public.roles r on r.id = u.role_id
   where u.role = 'super_admin' or r.nom = 'super_admin' limit 1;
  if v_mgr is null or v_sa is null then
    raise notice 'entreprise_suspendue.sql : pas de manager de test ou de super admin — répétition sautée.'; return;
  end if;

  begin
    v_etape := 'entreprise active : le manager passe';
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.verifier_entreprise_active();
    if public.get_my_tenant_id() is distinct from c_test then raise exception 'manager actif : get_my_tenant_id vide'; end if;
    select count(*) into n from public.statuts;
    if n = 0 then raise exception 'manager actif : il ne lit plus ses statuts'; end if;
    execute 'reset role';

    v_etape := 'entreprise suspendue : le manager est fermé';
    update public.tenants set statut = 'suspendu' where id = c_test;
    execute 'set local role authenticated';
    if public.get_my_tenant_id() is not null then raise exception 'suspendue : get_my_tenant_id rend encore l''entreprise'; end if;
    select count(*) into n from public.commandes;
    if n <> 0 then raise exception 'suspendue : le manager lit encore % commande(s)', n; end if;
    v_refus := false;
    begin perform public.verifier_entreprise_active();
    exception when insufficient_privilege then v_refus := sqlerrm like 'Entreprise suspendue%'; end;
    if not v_refus then raise exception 'suspendue : la porte laisse passer'; end if;

    v_etape := 'entreprise suspendue : le super admin passe';
    perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
    perform public.verifier_entreprise_active();
    select count(*) into n from public.tenants where id = c_test;
    if n <> 1 then raise exception 'super admin : il ne voit plus l''entreprise suspendue'; end if;

    execute 'reset role';
    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    if v_msg <> 'REPETITION_OK' then
      raise exception 'entreprise_suspendue.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'entreprise_suspendue.sql : entreprise suspendue fermée partout (base + porte avant chaque requête) ; super admin jamais bloqué. Répétition annulée (statut de test inchangé).';
end $$;

commit;

-- Ce qui est en place
select (select rolconfig::text from pg_roles where rolname = 'authenticator') as reglage_authenticator,
       (select string_agg(nom_entreprise || ' : ' || statut, ', ') from public.tenants)  as entreprises;
