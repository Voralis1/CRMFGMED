-- =============================================================================
-- T5 (partie sécurité) — LE NAVIGATEUR N'ÉCRIT PLUS LES PAIEMENTS — 13/11/2026 (sa décision)
-- NE MODIFIE AUCUN PAIEMENT. Retire les droits d'écriture du navigateur sur paiements.
-- =============================================================================
--
-- AVANT (lu en prod le 13/11, revue de sécurité) :
--   · paiements_update : le LIVREUR modifie SES paiements (montant, statut « remis »…),
--     et tout « responsable » — est_responsable() inclut le CEO — ceux de l'entreprise ;
--   · paiements_insert : le livreur crée un paiement pour lui-même ;
--   · paiements_delete : un responsable (CEO compris) en supprime ;
--   · authenticated a INSERT / UPDATE / DELETE sur la table ; aucune garde.
--   Depuis la console du navigateur : « ce paiement = 0, statut remis ».
--
-- QUI ÉCRIT VRAIMENT (lu le 13/11) — rien ne change pour eux :
--   · enregistrer_livraison (livraison_atomique.sql, T6) : SECURITY DEFINER, service role seul ;
--   · Edge Functions encaisser-paiement et remettre-caisse : clé service (adminClient) ;
--   · aucune page n'écrit paiements (la seule lecture : Caisse livreurs, un select).
--   La clé service et les fonctions du propriétaire ne passent ni par ces droits ni par la RLS.
--
-- APRÈS : lecture inchangée (paiements_select) ; écriture : AUCUN compte du navigateur
-- (livreur, CEO, manager, admin, super admin). Le reste du travail « cash » (T5 : qui a
-- fait quoi à chaque étape) reste en attente, sa décision du 02/11.
--
--   §1 fermer ; §2 contrôles ; §3 répétition (annulée) dans l'entreprise de test.
--
-- RETOUR ARRIÈRE : paiements_ecriture_fermee_retour.sql (copie sur le Bureau) — remet
-- les 3 règles telles que lues le 13/11 et les droits d'écriture.
-- =============================================================================

begin;

-- §1 Fermer l'écriture (toutes les règles qui ne sont pas de lecture : leçon 1) --------
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'paiements' and cmd <> 'SELECT' loop
    execute format('drop policy %I on public.paiements', p.policyname);
  end loop;
end $$;
revoke insert, update, delete, truncate on public.paiements from anon, authenticated;
grant select on public.paiements to authenticated;
grant all on public.paiements to service_role;

-- §2 Contrôles ----------------------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.paiements', 'insert')
       or has_table_privilege(r, 'public.paiements', 'update')
       or has_table_privilege(r, 'public.paiements', 'delete') then
      raise exception 'paiements_ecriture_fermee.sql : % écrit encore paiements. Rien n''est installé.', r;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'paiements' and cmd <> 'SELECT') then
    raise exception 'paiements_ecriture_fermee.sql : une règle d''écriture reste sur paiements. Rien n''est installé.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'paiements' and cmd = 'SELECT') then
    raise exception 'paiements_ecriture_fermee.sql : la règle de lecture paiements_select manque. Rien n''est installé.';
  end if;
  if not has_table_privilege('service_role', 'public.paiements', 'update') then
    raise exception 'paiements_ecriture_fermee.sql : le service role (Edge Functions) n''écrit plus paiements. Rien n''est installé.';
  end if;
end $$;

-- §3 Répétition (annulée) : livreur, CEO, manager refusés ; le livreur lit toujours ---------
do $$
declare
  c_test constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_livreur uuid; v_ceo uuid; v_mgr uuid; v_pai uuid; v_qui uuid; n bigint; v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  select lv.user_id into v_livreur from public.livreurs lv where lv.tenant_id = c_test and lv.user_id is not null limit 1;
  select user_id into v_ceo from public.user_roles where tenant_id = c_test and lower(role) = 'ceo' limit 1;
  select user_id into v_mgr from public.user_roles where tenant_id = c_test and lower(role) = 'manager' limit 1;
  select id into v_pai from public.paiements where tenant_id = c_test limit 1;
  if v_livreur is null or v_ceo is null or v_mgr is null then
    raise notice 'paiements_ecriture_fermee.sql : pas de livreur / CEO / manager de test — répétition sautée.'; return;
  end if;
  begin
    foreach v_qui in array array[v_livreur, v_ceo, v_mgr] loop
      v_etape := 'écriture refusée (' || (select role from public.user_roles where user_id = v_qui limit 1) || ')';
      perform set_config('request.jwt.claims', json_build_object('sub', v_qui, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_refus := false;
      begin update public.paiements set montant = 0 where tenant_id = c_test;
      exception when insufficient_privilege then v_refus := true; end;
      if not v_refus then raise exception 'il modifie encore un paiement'; end if;
      v_refus := false;
      begin insert into public.paiements (tenant_id, montant, statut) values (c_test, 0, 'remis');
      exception when insufficient_privilege then v_refus := true; end;
      if not v_refus then raise exception 'il crée encore un paiement'; end if;
      v_refus := false;
      begin delete from public.paiements where tenant_id = c_test;
      exception when insufficient_privilege then v_refus := true; end;
      if not v_refus then raise exception 'il supprime encore un paiement'; end if;
      execute 'reset role';
    end loop;

    v_etape := 'le livreur et le manager lisent toujours';
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.paiements;
    if v_pai is not null and n = 0 then raise exception 'le manager ne lit plus les paiements'; end if;
    execute 'reset role';

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    if v_msg <> 'REPETITION_OK' then
      raise exception 'paiements_ecriture_fermee.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'paiements_ecriture_fermee.sql : le navigateur lit les paiements, ne les écrit plus ; livraison, encaissement et remise passent par le serveur. Répétition annulée.';
end $$;

commit;

-- Ce qui est en place
select (select string_agg(cmd || ' ' || policyname, ', ') from pg_policies where tablename = 'paiements') as regles,
       has_table_privilege('authenticated', 'public.paiements', 'update') as navigateur_modifie,
       has_table_privilege('service_role', 'public.paiements', 'update')  as serveur_modifie;
