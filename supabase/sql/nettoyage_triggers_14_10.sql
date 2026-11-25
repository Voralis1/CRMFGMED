-- =============================================================================
-- Nettoyage des triggers et fonctions — 14/10/2026
-- À exécuter APRÈS correctif_urgent_14_10.sql.
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Stock à la livraison : passer par mouvements_stock
--
-- fn_ajuster_stock_livraison écrivait produits.current_quantity directement :
-- le stock par entrepôt (stocks) ne bougeait jamais à la livraison, et aucune
-- trace dans l'historique des mouvements. Règle de la fiche : toute sortie est
-- un mouvement, et trg_actualiser_stock fait le reste (stocks + produits).
--
-- Entrepôt : celui de la commande, sinon l'entrepôt du pays de la commande
-- (un entrepôt = un pays). Si aucun entrepôt n'est trouvé, on garde l'ancien
-- comportement (produits seulement) plutôt que de perdre la sortie.
--
-- SECURITY DEFINER : le trigger écrit dans mouvements_stock, que seuls admin
-- et manager peuvent écrire. Sans cela, une livraison faite par un livreur
-- depuis le navigateur serait refusée.
-- -----------------------------------------------------------------------------
-- GARDE (02/11) : fn_ajuster_stock_livraison est définie aujourd'hui par stock_livraison_autre_vendeur.sql.
-- Ce fichier ne la réécrit que si elle manque, n'a pas de marque, porte la
-- sienne ou celle d'un fichier plus ancien. Marquée par un fichier plus
-- récent → gardée telle quelle, avec un avis (rien n'échoue).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.fn_ajuster_stock_livraison()'), 'pg_proc');
begin
  if v_marque in ('fichier: entrepot_commande.sql', 'fichier: stock_livraison_autre_vendeur.sql') then
    raise notice 'nettoyage_triggers_14_10.sql : fn_ajuster_stock_livraison gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.fn_ajuster_stock_livraison()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_produit_nom text;
  v_quantite    integer;
  v_tenant_id   uuid;
  v_pays_id     uuid;
  v_entrepot_id uuid;
  v_produit_id  uuid;
  v_type        text;
begin
  -- Rien à faire si le statut n'a pas changé (évite les ajustements en double)
  if tg_op = 'UPDATE' and old.statut is not distinct from new.statut then
    return new;
  end if;

  -- Livrée : sortie. Livrée puis autre chose : retour en stock. Sinon rien.
  if new.statut = 'livre' and (tg_op = 'INSERT' or old.statut is distinct from 'livre') then
    v_type := 'sortie';
  elsif tg_op = 'UPDATE' and old.statut = 'livre' and new.statut is distinct from 'livre' then
    v_type := 'retour_ok';
  else
    return new;
  end if;

  select c.produit, c.quantite, c.tenant_id, c.pays_id, c.entrepot_id
    into v_produit_nom, v_quantite, v_tenant_id, v_pays_id, v_entrepot_id
  from public.commandes c
  where c.id = new.commande_id;

  if v_produit_nom is null or v_quantite is null then
    return new;
  end if;

  select p.id into v_produit_id
  from public.produits p
  where lower(trim(p.product)) = lower(trim(v_produit_nom))
    and p.tenant_id = v_tenant_id
  limit 1;

  -- Produit introuvable dans le catalogue : la livraison n'est pas bloquée
  if v_produit_id is null then
    return new;
  end if;

  if v_entrepot_id is null and v_pays_id is not null then
    select e.id into v_entrepot_id
    from public.entrepots e
    where e.tenant_id = v_tenant_id
      and e.pays_id = v_pays_id
    order by e.actif desc nulls last, e.created_at
    limit 1;
  end if;

  if v_entrepot_id is not null then
    insert into public.mouvements_stock (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
    values (v_tenant_id, v_produit_id, v_entrepot_id, v_type, v_quantite,
            case v_type when 'sortie' then 'Livraison ' else 'Annulation livraison ' end || new.id);
  else
    -- Aucun entrepôt pour ce pays : ancien comportement, produits seulement
    update public.produits
       set current_quantity = case v_type
             when 'sortie' then greatest(coalesce(current_quantity, 0) - v_quantite, 0)
             else coalesce(current_quantity, 0) + v_quantite
           end
     where id = v_produit_id;
  end if;

  return new;
end;
$function$
$def$;
  comment on function public.fn_ajuster_stock_livraison() is 'fichier: nettoyage_triggers_14_10.sql';
end $garde$;


-- -----------------------------------------------------------------------------
-- 1 bis. choisir_livreur : compter la vraie charge du livreur
--
-- Le tri comptait les livraisons 'en_attente', un statut que la contrainte
-- livraisons_statut_valide interdit désormais : le compte valait toujours 0 et
-- le choix devenait du pur hasard. La charge = ce qu'il a encore à livrer.
-- -----------------------------------------------------------------------------
-- GARDE (02/11) : choisir_livreur est définie aujourd'hui par livreur_par_zone.sql.
-- Ce fichier ne la réécrit que si elle manque, n'a pas de marque, porte la
-- sienne ou celle d'un fichier plus ancien. Marquée par un fichier plus
-- récent → gardée telle quelle, avec un avis (rien n'échoue).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.choisir_livreur(uuid, uuid, text, uuid)'), 'pg_proc');
begin
  if v_marque in ('fichier: livreur_par_zone.sql') then
    raise notice 'nettoyage_triggers_14_10.sql : choisir_livreur gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.choisir_livreur (
  p_tenant  uuid,
  p_pays    uuid,
  p_ville   text,
  p_exclure uuid default null::uuid
)
  returns uuid
  language sql
  security definer
  set search_path to 'public'
  as $function$
  select l.id
  from public.livreurs l
  where l.tenant_id = p_tenant
    and l.pays_id = p_pays
    and l.actif = true
    and l.user_id is not null
    and (p_exclure is null or l.id <> p_exclure)
    and l.zone is not null and btrim(l.zone) <> ''
    and p_ville is not null
    and lower(p_ville) like '%' || lower(btrim(l.zone)) || '%'
  order by
    (select count(*) from public.livraisons v
      where v.livreur_id = l.id and v.statut in ('a_preparer', 'expedie')),
    random()
  limit 1
$function$
$def$;
  comment on function public.choisir_livreur(uuid, uuid, text, uuid) is 'fichier: nettoyage_triggers_14_10.sql';
end $garde$;


-- -----------------------------------------------------------------------------
-- 2. Un seul trigger d'affectation d'agent sur commandes
--
-- tr_auto_affecter_agent choisit un agent DU PAYS de la commande.
-- trigger_assignation_auto passait ensuite et donnait le lead à n'importe quel
-- agent de l'entreprise, sans regarder le pays. On garde le premier : un lead
-- sans agent du pays reste visible dans le pool, au lieu d'arriver chez un
-- agent qui ne parle pas au bon pays.
-- -----------------------------------------------------------------------------
drop trigger if exists trigger_assignation_auto on public.commandes;
drop function if exists public.assigner_lead_automatiquement();


-- -----------------------------------------------------------------------------
-- 3. Un seul trigger tenant_id par table
--
-- agents et commandes avaient deux triggers qui font la même chose
-- (tr_set_tenant_id_* et trg_set_tenant_id_*). On garde trg_set_tenant_id_*,
-- le même que sur toutes les autres tables. set_tenant_id() n'a plus d'usage.
-- -----------------------------------------------------------------------------
drop trigger if exists tr_set_tenant_id_agents    on public.agents;
drop trigger if exists tr_set_tenant_id_commandes on public.commandes;

do $$ begin
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where p.proname = 'set_tenant_id' and p.pronamespace = 'public'::regnamespace
  ) then
    drop function if exists public.set_tenant_id();
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Fonctions de debug : à supprimer
-- -----------------------------------------------------------------------------
drop function if exists public.debug_check_definer();
drop function if exists public.debug_check_invoker();
drop function if exists public.debug_auth_uid();


-- -----------------------------------------------------------------------------
-- 5. search_path fixé sur la dernière fonction SECURITY DEFINER qui ne l'avait pas
-- -----------------------------------------------------------------------------
alter function public.get_mes_permissions() set search_path to 'public';


-- -----------------------------------------------------------------------------
-- 6. choisir_agent / choisir_livreur : appelées par les triggers seulement
--    02/11 : plus à `authenticated` non plus (choisir_fermes.sql) — elles ne
--    regardent pas l'entreprise de l'appelant. Relancer ce fichier ne les
--    rouvre pas.
-- -----------------------------------------------------------------------------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('choisir_agent', 'choisir_livreur')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- Vérification (lecture seule)
-- Attendu : aucune ligne pour les triggers et les debug, stock_definer = true
-- -----------------------------------------------------------------------------
select 'trigger en trop' as probleme, tgname as nom
  from pg_trigger
 where tgname in ('trigger_assignation_auto', 'tr_set_tenant_id_agents', 'tr_set_tenant_id_commandes')
union all
select 'fonction debug', proname
  from pg_proc
 where pronamespace = 'public'::regnamespace and proname like 'debug_%';

select prosecdef as stock_definer
  from pg_proc
 where pronamespace = 'public'::regnamespace and proname = 'fn_ajuster_stock_livraison';
