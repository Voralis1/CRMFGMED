-- =============================================================================
-- Correctif urgent — 14/10/2026
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. vider_donnees_operationnelles : fermer la porte au navigateur
--
-- La fonction est SECURITY DEFINER, ne vérifie personne, et était exécutable par
-- anon et authenticated. N'importe qui avec la clé publique et un tenant_id
-- pouvait vider les commandes, livraisons, paiements… d'une entreprise.
-- Elle reste utilisable depuis l'éditeur SQL (postgres) et le service_role.
-- -----------------------------------------------------------------------------
revoke execute on function public.vider_donnees_operationnelles(uuid) from public, anon, authenticated;
grant  execute on function public.vider_donnees_operationnelles(uuid) to postgres, service_role;


-- -----------------------------------------------------------------------------
-- 2. Les autres portes SECURITY DEFINER : retirer anon
--
-- Pour anon, auth.uid() est NULL : la garde de supprimer_pays
-- (« if auth.uid() is not null and … ») laisse donc passer un appel anonyme.
-- Ces fonctions ne servent qu'à des utilisateurs connectés.
-- -----------------------------------------------------------------------------
revoke execute on function public.supprimer_pays(uuid)                                    from public, anon;
revoke execute on function public.rattacher_produit_pays(uuid, uuid[])                     from public, anon;
revoke execute on function public.receptionner_expedition(uuid, timestamptz, uuid, jsonb)  from public, anon;
revoke execute on function public.pays_du_produit(uuid)                                    from public, anon;

grant execute on function public.supprimer_pays(uuid)                                    to authenticated, service_role;
grant execute on function public.rattacher_produit_pays(uuid, uuid[])                     to authenticated, service_role;
grant execute on function public.receptionner_expedition(uuid, timestamptz, uuid, jsonb)  to authenticated, service_role;
grant execute on function public.pays_du_produit(uuid)                                    to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. auto_affecter_livreur : 'en_attente' → 'a_preparer'
--
-- La contrainte livraisons_statut_valide n'accepte que
-- a_preparer / expedie / livre / retour / annule. Le trigger insérait encore
-- 'en_attente' : dès qu'un livreur était trouvé pour la zone, la confirmation
-- d'une commande échouait (l'appel était enregistré, la commande restait non
-- confirmée). Seule la valeur du statut change.
-- -----------------------------------------------------------------------------
-- GARDE (02/11) : auto_affecter_livreur est définie aujourd'hui par livreur_par_zone.sql.
-- Ce fichier ne la réécrit que si elle manque, n'a pas de marque, porte la
-- sienne ou celle d'un fichier plus ancien. Marquée par un fichier plus
-- récent → gardée telle quelle, avec un avis (rien n'échoue).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.auto_affecter_livreur()'), 'pg_proc');
begin
  if v_marque in ('fichier: livreur_par_zone.sql') then
    raise notice 'correctif_urgent_14_10.sql : auto_affecter_livreur gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.auto_affecter_livreur()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_livreur uuid;
  v_declenche boolean;
begin
  if new.statut_confirmation is null then return new; end if;

  if tg_op = 'UPDATE'
     and new.statut_confirmation is not distinct from old.statut_confirmation then
    return new;
  end if;

  select coalesce(bool_or(s.declenche_assignation), false) into v_declenche
  from public.statuts s
  where s.tenant_id = new.tenant_id
    and (s.nom = new.statut_confirmation or s.code = new.statut_confirmation)
    and (s.pays_id is null or s.pays_id = new.pays_id);

  if not v_declenche then return new; end if;

  if exists (select 1 from public.livraisons v where v.commande_id = new.id) then
    return new;
  end if;

  v_livreur := public.choisir_livreur(new.tenant_id, new.pays_id, new.ville_zone);

  if v_livreur is not null then
    insert into public.livraisons (commande_id, livreur_id, tenant_id, statut)
    values (new.id, v_livreur, new.tenant_id, 'a_preparer');
  end if;

  return new;
end;
$function$
$def$;
  comment on function public.auto_affecter_livreur() is 'fichier: correctif_urgent_14_10.sql';
end $garde$;


-- -----------------------------------------------------------------------------
-- Vérification (lecture seule) — doit montrer false / false / true
-- -----------------------------------------------------------------------------
select
  has_function_privilege('anon',          'public.vider_donnees_operationnelles(uuid)', 'execute') as anon_peut_vider,
  has_function_privilege('authenticated', 'public.vider_donnees_operationnelles(uuid)', 'execute') as connecte_peut_vider,
  position('a_preparer' in pg_get_functiondef('public.auto_affecter_livreur'::regproc)) > 0      as trigger_corrige;
