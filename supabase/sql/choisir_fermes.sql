-- =============================================================================
-- choisir_agent / choisir_livreur : FERMÉES aux comptes de l'application
-- 02/11/2026
-- =============================================================================
--
-- NE CHANGE AUCUNE DONNÉE, AUCUN CORPS DE FONCTION. Retire un droit.
--
-- LE TROU : les deux fonctions tournent avec les droits de leur propriétaire
-- (SECURITY DEFINER), ne regardent pas l'entreprise de l'appelant, et
-- `authenticated` pouvait les appeler. N'importe quel compte connecté, de
-- N'IMPORTE QUELLE entreprise, obtenait l'id de l'agent ou du livreur qu'une
-- autre entreprise choisirait pour un pays (et, pour le livreur, quelles
-- villes ont un livreur) :
--     select public.choisir_agent('<entreprise>', '<pays>');
--
-- QUI EN A BESOIN (lu en production le 02/11) :
--   · choisir_agent   — le trigger tr_auto_affecter_agent (auto_affecter_agent,
--     SECURITY DEFINER : il l'appelle avec les droits du propriétaire, pas
--     ceux du compte qui crée la commande) ;
--   · choisir_livreur — plus personne (auto_affecter_livreur appelle
--     livreur_pour_commande depuis livreur_par_zone.sql) ;
--   · aucune page, aucune Edge Function.
-- service_role garde le droit (il passe déjà outre la RLS).
--
-- nettoyage_triggers_14_10.sql les rouvrait à `authenticated` : corrigé le
-- 02/11 (il ne donne plus que service_role) — le relancer ne rouvre rien.
--
-- RÉPÉTITION (§2, annulée) : sous les droits d'un vendeur de l'entreprise de
-- test, une commande créée reçoit toujours son agent par le trigger, et
-- l'appel direct est refusé. Un échec → rien n'est installé.
--
-- RETOUR ARRIÈRE : choisir_fermes_retour.sql (rend le droit à authenticated).
-- =============================================================================

-- 1. Le droit
revoke execute on function public.choisir_agent(uuid, uuid)                 from public, anon, authenticated;
revoke execute on function public.choisir_livreur(uuid, uuid, text, uuid)   from public, anon, authenticated;
grant  execute on function public.choisir_agent(uuid, uuid)                 to service_role;
grant  execute on function public.choisir_livreur(uuid, uuid, text, uuid)   to service_role;

-- 2. Répétition
do $$
declare
  v_t     uuid;
  v_pays  uuid;
  v_vend  uuid;
  v_agent uuid;
  v_id    uuid;
  v_msg   text;
  v_refus boolean;
begin
  if has_function_privilege('authenticated', 'public.choisir_agent(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.choisir_agent(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.choisir_livreur(uuid, uuid, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.choisir_livreur(uuid, uuid, text, uuid)', 'execute') then
    raise exception 'choisir_fermes.sql : un compte de l''application peut encore les appeler (un GRANT à PUBLIC ?). Rien n''est installé.';
  end if;

  -- Un vendeur et un pays où un agent actif travaille, dans l'entreprise de test d'abord.
  select a.tenant_id, a.pays_id into v_t, v_pays
    from public.agents a join public.user_roles ur on ur.user_id = a.user_id and lower(ur.role) = 'agent'
   where a.actif and a.pays_id is not null
     and exists (select 1 from public.user_roles s where s.tenant_id = a.tenant_id and s.role = 'seller')
   order by (a.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, a.tenant_id limit 1;
  if v_t is null then
    raise notice 'Répétition sautée : aucune entreprise avec un vendeur et un agent actif.';
    return;
  end if;
  select user_id into v_vend from public.user_roles where tenant_id = v_t and role = 'seller' order by user_id limit 1;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    -- l'appel direct : refusé
    v_refus := false;
    begin
      perform public.choisir_agent(v_t, v_pays);
    exception when insufficient_privilege then v_refus := true;
    end;
    if not v_refus then raise exception 'un vendeur appelle encore choisir_agent'; end if;

    -- le chemin normal : une commande créée par le vendeur reçoit son agent
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix,
                                  pays_id, ville_zone, vendeur_id)
    values (v_t, 'REPETITION-CHOISIR-' || gen_random_uuid(), 'Répétition', '+000', 'Répétition', 1, 0,
            v_pays, 'Répétition', v_vend)
    returning id into v_id;
    execute 'reset role';
    select agent_id into v_agent from public.commandes where id = v_id;
    if v_agent is null then raise exception 'la commande du vendeur n''a pas reçu d''agent (le trigger n''a pas pu choisir)'; end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'choisir_fermes.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;
  raise notice 'choisir_fermes.sql : fermées à anon/authenticated ; un vendeur reçoit toujours son agent par le trigger (répétition annulée).';
end $$;

-- Ce qui est en place
select p.oid::regprocedure as fonction, p.proacl as droits
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('choisir_agent', 'choisir_livreur');
