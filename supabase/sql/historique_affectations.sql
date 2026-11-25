-- =============================================================================
-- Historique des affectations (agent, livreur) + affectation par lot — 29/10/2026
-- =============================================================================
--
-- AVANT CE FICHIER : changer l'agent d'un lead (Centre d'appel) ou le livreur
-- d'une commande (Assignation livreur) ne laissait AUCUNE trace —
-- historique_statuts n'enregistre que les statuts. Avec la sélection
-- multiple, un clic déplace cinquante leads : il faut que chacun le dise.
--
-- UNE LIGNE PAR CHANGEMENT, par TOUS les chemins (écran, lot, triggers
-- automatiques, clé service, éditeur SQL), jamais modifiée, JAMAIS supprimée —
-- pas même avec sa commande. Même forme que historique_statuts.sql :
-- commande en SET NULL, ce qui identifie la commande figé sur la ligne, garde,
-- vue = seul chemin de lecture.
--
-- D'OÙ VIENT LE LIVREUR : de `livraisons.livreur_id` (la ligne de livraison),
-- et l'état de la livraison de `livraisons.statut`. JAMAIS de
-- `commandes.statut_livraison` : ce miroir est faux sur 4 commandes sur 14
-- (lu le 28/10). Ni le trigger ni la fonction de lot ne le lisent.
--
-- CE QUE FAIT CE FICHIER (il ne modifie AUCUNE commande ni livraison) :
--   §1  arrêt si les prérequis manquent ;
--   §2  la table `historique_affectations` — aucun droit pour l'app ;
--   §3  la garde (pas d'écriture à la main, pas de suppression, seule
--       modification : le lien vers une commande supprimée → NULL) ;
--   §4  les deux triggers : commandes.agent_id, livraisons.livreur_id ;
--   §5  affecter_agent_lot(entreprise, ids, agent) ;
--   §6  affecter_livreur_lot(entreprise, ids, livreur) ;
--       UN appel = UN lot : chaque commande est appliquée ou refusée
--       SEULE (sous-bloc), le refus d'une ligne n'annule pas les autres, et
--       la fonction rend une ligne par commande : appliqué / inchangé /
--       refusé + la raison. Si l'appel échoue en entier (réseau, droit),
--       RIEN n'est appliqué : pas de lot à moitié écrit ;
--   §7  la vue `v_historique_affectations` (responsables, ceo, super_admin ;
--       jamais le vendeur, l'agent ni le livreur) ;
--   §8  vérification ;
--   §9  répétition : de vraies écritures dans l'entreprise de test, annulées
--       à la fin. Un trigger fautif arrête le fichier ICI, rien n'est installé.
--
-- Pas de reprise du passé : il n'y a rien à reprendre (aucune trace avant).
-- Les affectations d'aujourd'hui commencent leur historique au premier
-- changement après l'installation.
--
-- ORDRE : ce fichier, PUIS les pages (Centre d'appel, Assignation livreur),
-- qui appellent les fonctions du §5 et du §6. Aucun déploiement de fonction.
-- Retour arrière : historique_affectations_retour.sql
-- (copie : ~/Desktop/RETOUR_historique_affectations.sql).
--
-- Exécutable en entier, et deux fois.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Prérequis
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.historique_statuts') is null then
    raise exception 'Lancez d''abord historique_statuts.sql. Rien n''a été installé.';
  end if;
  if to_regprocedure('public.a_la_permission(text)') is null then
    raise exception 'public.a_la_permission(text) manque (rls_sources_import.sql). Rien n''a été installé.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. La table
-- -----------------------------------------------------------------------------
-- Mêmes choix que historique_statuts (voir ce fichier, §2) : une seule clé
-- étrangère, la commande, en SET NULL ; pas de clé vers les agents, livreurs
-- ou comptes — leurs noms sont figés sur la ligne (supprimer un livreur ne
-- réécrit pas l'histoire, et un SET NULL serait une modification que la
-- garde refuse).
create table if not exists public.historique_affectations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  commande_id       uuid references public.commandes(id) on delete set null,
  vendeur_id        uuid,
  commande_lead_id  text,
  commande_tracking text,
  commande_client   text,
  commande_produit  text,
  -- 'agent' : commandes.agent_id ; 'livreur' : livraisons.livreur_id.
  quoi              text not null check (quoi in ('agent', 'livreur')),
  -- avant NULL = première affectation ; après NULL = retiré.
  avant_id          uuid,
  avant_nom         text,
  apres_id          uuid,
  apres_nom         text,
  -- Le compte qui a agi ; NULL = personne d'identifiable (éditeur SQL,
  -- clé service).
  fait_par          uuid,
  fait_par_nom      text,
  -- Par où :
  --   affectation : affecter_agent_lot / affecter_livreur_lot (les écrans,
  --                 une ligne seule comme un lot) — lot_id rempli ;
  --   creation    : l'agent donné à la naissance du lead (tr_auto_affecter_agent) ;
  --   automatique : posé par un autre trigger (le livreur choisi à la
  --                 confirmation) — fait_par = celui qui a confirmé ;
  --   navigateur  : un update direct d'un compte connecté ;
  --   systeme     : clé service hors lot (assigner-livreur), éditeur SQL.
  via               text not null
                    check (via in ('affectation', 'creation', 'automatique', 'navigateur', 'systeme')),
  -- Les lignes d'UN même clic portent le même lot_id : vingt lignes, une action.
  lot_id            uuid,
  cree_le           timestamptz not null default now()
);

create index if not exists idx_historique_affectations_commande
  on public.historique_affectations (commande_id, cree_le);
create index if not exists idx_historique_affectations_tenant
  on public.historique_affectations (tenant_id, cree_le);
create index if not exists idx_historique_affectations_lot
  on public.historique_affectations (lot_id) where lot_id is not null;

alter table public.historique_affectations enable row level security;
revoke all on public.historique_affectations from public, anon, authenticated, service_role;
grant select on public.historique_affectations to service_role;


-- -----------------------------------------------------------------------------
-- 3. La garde
-- -----------------------------------------------------------------------------
-- INSERT : seulement depuis un trigger (profondeur ≥ 2 : le trigger de
--   commandes ou de livraisons, puis cette garde). Aucune reprise ne passe.
-- UPDATE : seulement commande_id → NULL quand la commande n'existe plus.
-- DELETE, TRUNCATE : jamais, pour personne.
create or replace function public.historique_affectations_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if pg_trigger_depth() < 2 then
      raise exception 'L''historique des affectations ne s''écrit pas à la main : il s''écrit tout seul quand un agent ou un livreur change.';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.commande_id is not null
       and new.commande_id is null
       and (to_jsonb(new) - 'commande_id') = (to_jsonb(old) - 'commande_id')
       and not exists (select 1 from public.commandes where id = old.commande_id) then
      return new;
    end if;
    raise exception 'L''historique des affectations ne se modifie pas.';
  elsif tg_op = 'DELETE' then
    raise exception 'L''historique des affectations ne se supprime pas, même quand sa commande est supprimée.';
  else
    raise exception 'L''historique des affectations ne se vide pas.';
  end if;
end;
$$;

revoke all on function public.historique_affectations_garde() from public, anon, authenticated;

create or replace trigger trg_historique_affectations_garde
  before insert or update or delete on public.historique_affectations
  for each row execute function public.historique_affectations_garde();

create or replace trigger trg_historique_affectations_garde_vider
  before truncate on public.historique_affectations
  for each statement execute function public.historique_affectations_garde();


-- -----------------------------------------------------------------------------
-- 4. Les triggers
-- -----------------------------------------------------------------------------
-- Une seule fonction écrit la ligne, appelée par les deux triggers. Elle
-- n'est pas appelable par l'app ; appelée hors trigger (éditeur SQL), la
-- garde la refuse (profondeur 1).
--
-- Qui : auth.uid() s'il existe (on ne se fait pas passer pour un autre),
-- sinon ce que enregistrer_appel a posé pour la transaction (la confirmation
-- par confirmer-appel qui déclenche le livreur automatique), sinon personne.
-- GARDE (13/11) : historiser_affectation est reprise par reaffectation_delai.sql
-- (« delai »). Marquée par lui → gardée telle quelle.
do $garde_reaffectation$
begin
  if obj_description(to_regprocedure('public.historiser_affectation(text, public.commandes, uuid, uuid, boolean)'), 'pg_proc')
     = 'fichier: reaffectation_delai.sql' then
    raise notice 'historique_affectations.sql : historiser_affectation gardée (reaffectation_delai.sql, plus récent). Pas réécrite.';
    return;
  end if;
create or replace function public.historiser_affectation(
  p_quoi     text,
  p_commande public.commandes,
  p_avant    uuid,
  p_apres    uuid,
  p_creation boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot    uuid := nullif(current_setting('crm.affectation_lot', true), '')::uuid;
  v_acteur uuid := coalesce(auth.uid(), nullif(current_setting('crm.historique_acteur', true), '')::uuid);
  v_via    text;
  v_nom    text;
  v_avant  text;
  v_apres  text;
begin
  -- pg_trigger_depth() vaut ici 1 pour le trigger appelant ; 2 ou plus si
  -- l'écriture vient elle-même d'un trigger (auto_affecter_livreur).
  v_via := case
    when v_lot is not null         then 'affectation'
    when p_creation                then 'creation'
    when pg_trigger_depth() > 1    then 'automatique'
    when auth.uid() is not null    then 'navigateur'
    else 'systeme'
  end;

  if v_acteur is not null then
    select coalesce(
             (select nullif(btrim(a.nom), '') from public.agents a
               where a.user_id = v_acteur and a.tenant_id = p_commande.tenant_id limit 1),
             (select nullif(btrim(ur.nom), '') from public.user_roles ur
               where ur.user_id = v_acteur limit 1),
             (select ur.email from public.user_roles ur
               where ur.user_id = v_acteur limit 1))
      into v_nom;
  end if;

  if p_quoi = 'agent' then
    select nullif(btrim(nom), '') into v_avant from public.agents where id = p_avant;
    select nullif(btrim(nom), '') into v_apres from public.agents where id = p_apres;
  else
    select nullif(btrim(nom), '') into v_avant from public.livreurs where id = p_avant;
    select nullif(btrim(nom), '') into v_apres from public.livreurs where id = p_apres;
  end if;

  insert into public.historique_affectations
    (tenant_id, commande_id, vendeur_id,
     commande_lead_id, commande_tracking, commande_client, commande_produit,
     quoi, avant_id, avant_nom, apres_id, apres_nom,
     fait_par, fait_par_nom, via, lot_id)
  values
    (p_commande.tenant_id, p_commande.id, p_commande.vendeur_id,
     p_commande.lead_id, p_commande.tracking_number, p_commande.client_nom, p_commande.produit,
     p_quoi, p_avant, v_avant, p_apres, v_apres,
     v_acteur, v_nom, v_via, v_lot);
end;
$$;
end $garde_reaffectation$;

revoke all on function public.historiser_affectation(text, public.commandes, uuid, uuid, boolean)
  from public, anon, authenticated;

-- 4a. L'agent : commandes.agent_id. À la naissance (s'il y en a un) et à
-- chaque changement, retrait compris.
create or replace function public.ecrire_historique_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.agent_id is null then return null; end if;
    perform public.historiser_affectation('agent', new, null, new.agent_id, true);
  elsif new.agent_id is distinct from old.agent_id then
    perform public.historiser_affectation('agent', new, old.agent_id, new.agent_id, false);
  end if;
  return null;
end;
$$;

revoke all on function public.ecrire_historique_agent() from public, anon, authenticated;

create or replace trigger trg_historique_agent
  after insert or update of agent_id on public.commandes
  for each row execute function public.ecrire_historique_agent();

-- 4b. Le livreur : livraisons.livreur_id — la ligne de livraison, la seule
-- qui dise qui a la marchandise. Création de la livraison avec un livreur,
-- puis chaque changement. La commande est relue ici (pour ce qui l'identifie).
create or replace function public.ecrire_historique_livreur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cmd public.commandes;
begin
  if tg_op = 'INSERT' then
    if new.livreur_id is null then return null; end if;
  elsif new.livreur_id is not distinct from old.livreur_id then
    return null;
  end if;

  select * into v_cmd from public.commandes where id = new.commande_id;
  if not found then
    return null; -- livraison sans commande : rien à rattacher
  end if;

  perform public.historiser_affectation('livreur', v_cmd,
    case when tg_op = 'UPDATE' then old.livreur_id end, new.livreur_id, false);
  return null;
end;
$$;

revoke all on function public.ecrire_historique_livreur() from public, anon, authenticated;

create or replace trigger trg_historique_livreur
  after insert or update of livreur_id on public.livraisons
  for each row execute function public.ecrire_historique_livreur();


-- -----------------------------------------------------------------------------
-- 5. affecter_agent_lot(entreprise, ids, agent)
-- -----------------------------------------------------------------------------
-- Qui : admin, manager de CETTE entreprise, super_admin (la règle de
-- remonter_leads ; le ceo lit, il n'arbitre pas).
-- Refus de TOUT le lot (rien n'est écrit) : pas connecté, pas le droit,
-- agent inconnu / d'une autre entreprise / inactif / sans compte, plus de
-- 500 commandes. Ils valent pour chaque ligne de la même façon.
-- Refus d'UNE ligne (les autres passent), avec la raison :
--   · commande introuvable dans cette entreprise ;
--   · agent d'un autre pays que la commande ;
--   · toute erreur de la base sur cette ligne (texte rendu tel quel).
-- Résultat par commande : 'applique', 'inchange' (avait déjà cet agent),
-- 'refuse' + motif.
--
-- TOUS les leads, traités compris (29/10, sa décision ; avant : Pending
-- seulement). Pourquoi c'est sans danger :
--   · l'historique est le contrôle : chaque ligne de historique_statuts
--     garde celui qui a FAIT l'action (figé à l'écriture, jamais réécrit) —
--     les appels du premier agent restent à son nom, ceux du nouveau
--     s'ajoutent dessous ; et chaque changement d'agent a ici sa ligne ;
--   · Performances compte les APPELS par appels.agent_id, posé à l'écriture
--     de l'appel (le profil de celui qui appelle), pas par l'agent actuel du
--     lead : changer l'agent ne déplace aucun appel ni aucune confirmation.
create or replace function public.affecter_agent_lot(p_tenant uuid, p_ids uuid[], p_agent uuid)
returns table (commande_id uuid, resultat text, motif text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent public.agents;
  v_id    uuid;
  v_cmd   public.commandes;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if not (public.is_super_admin()
          or (lower(coalesce(public.mon_role(), '')) in ('admin', 'manager')
              and p_tenant = public.get_my_tenant_id())) then
    raise exception 'Seuls un manager ou un admin de cette entreprise changent l''agent d''un lead.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Au plus 500 leads par lot (% demandés).', cardinality(p_ids);
  end if;
  -- « Actions en masse » (30/10) : un LOT (plus d'une commande) demande cette
  -- permission EN PLUS du droit à l'action ci-dessus. Une seule commande garde
  -- la règle d'avant. Lu dans role_permissions (/super-admin/roles), jamais
  -- sur un nom de rôle.
  if cardinality(p_ids) > 1 and not (public.is_super_admin() or public.a_la_permission('actions_masse')) then
    raise exception 'Actions en masse : votre rôle ne permet pas de modifier plusieurs commandes à la fois.' using errcode = '42501';
  end if;

  select * into v_agent from public.agents a where a.id = p_agent and a.tenant_id = p_tenant;
  if not found then
    raise exception 'Agent introuvable dans cette entreprise.';
  end if;
  if v_agent.actif is not true or v_agent.user_id is null then
    raise exception 'L''agent % est inactif ou n''a plus de compte : choisissez-en un autre.', v_agent.nom;
  end if;

  perform set_config('crm.affectation_lot', gen_random_uuid()::text, true);

  for v_id in select distinct x from unnest(p_ids) as x where x is not null loop
    commande_id := v_id;
    begin
      -- Verrou : rien ne change cette commande entre la vérification et l'écriture.
      select * into v_cmd from public.commandes c
       where c.id = v_id and c.tenant_id = p_tenant
       for update;
      if not found then
        resultat := 'refuse'; motif := 'Commande introuvable dans cette entreprise.';
      elsif v_agent.pays_id is not null and v_cmd.pays_id is distinct from v_agent.pays_id then
        resultat := 'refuse'; motif := format('%s ne travaille pas dans le pays de cette commande.', v_agent.nom);
      elsif v_cmd.agent_id = p_agent then
        resultat := 'inchange'; motif := null;
      else
        update public.commandes c set agent_id = p_agent where c.id = v_id;
        resultat := 'applique'; motif := null;
      end if;
    exception when others then
      -- La ligne seule est annulée (son historique avec elle) ; on continue.
      resultat := 'refuse'; motif := sqlerrm;
    end;
    return next;
  end loop;

  perform set_config('crm.affectation_lot', '', true);
end;
$$;

revoke all on function public.affecter_agent_lot(uuid, uuid[], uuid) from public, anon;
grant execute on function public.affecter_agent_lot(uuid, uuid[], uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 6. affecter_livreur_lot(entreprise, ids, livreur)
-- -----------------------------------------------------------------------------
-- Qui : la permission `assigner_livreur` (admin, manager, super_admin en prod
-- le 29/10 — la même que assigner-livreur) dans CETTE entreprise, ou
-- super_admin.
-- Refus de tout le lot : pas connecté, pas le droit, livreur inconnu / d'une
-- autre entreprise / désactivé / sans pays, plus de 500 commandes.
-- Refus d'une ligne :
--   · commande introuvable dans cette entreprise ;
--   · commande pas confirmée (aucun statut `declenche_assignation` pour son
--     pays) — « sans confirmation, on n'expédie pas ». assigner-livreur ne le
--     vérifiait pas ; l'écran ne montrait de toute façon que des confirmées ;
--   · livreur d'un autre pays que la commande ;
--   · une livraison existe et n'est plus « à préparer » (expédiée, livrée,
--     retour, annulée) : l'état est lu sur `livraisons.statut`, jamais sur
--     commandes.statut_livraison ;
--   · toute erreur de la base sur cette ligne.
-- Une livraison « à préparer » change de livreur ; pas de livraison → elle est
-- créée « a_preparer » (comme assigner-livreur et le choix automatique).
create or replace function public.affecter_livreur_lot(p_tenant uuid, p_ids uuid[], p_livreur uuid)
returns table (commande_id uuid, resultat text, motif text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liv     public.livreurs;
  v_id      uuid;
  v_cmd     public.commandes;
  v_bloque  text;
  v_actuel  uuid;
  v_n       integer;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if not (public.is_super_admin()
          or (public.a_la_permission('assigner_livreur')
              and p_tenant = public.get_my_tenant_id())) then
    raise exception 'Vous n''avez pas le droit d''assigner un livreur dans cette entreprise.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Au plus 500 commandes par lot (% demandées).', cardinality(p_ids);
  end if;
  -- « Actions en masse » (30/10) : un LOT (plus d'une commande) demande cette
  -- permission EN PLUS du droit à l'action ci-dessus. Une seule commande garde
  -- la règle d'avant. Lu dans role_permissions (/super-admin/roles), jamais
  -- sur un nom de rôle.
  if cardinality(p_ids) > 1 and not (public.is_super_admin() or public.a_la_permission('actions_masse')) then
    raise exception 'Actions en masse : votre rôle ne permet pas de modifier plusieurs commandes à la fois.' using errcode = '42501';
  end if;

  select * into v_liv from public.livreurs l where l.id = p_livreur and l.tenant_id = p_tenant;
  if not found then
    raise exception 'Livreur introuvable dans cette entreprise.';
  end if;
  if v_liv.actif is false then
    raise exception 'Le livreur % est désactivé.', v_liv.nom;
  end if;
  if v_liv.pays_id is null then
    raise exception 'Le livreur % n''a pas de pays : il ne peut prendre aucune commande.', v_liv.nom;
  end if;

  perform set_config('crm.affectation_lot', gen_random_uuid()::text, true);

  for v_id in select distinct x from unnest(p_ids) as x where x is not null loop
    commande_id := v_id;
    begin
      -- Le verrou sur la commande sérialise aussi avec auto_affecter_livreur
      -- (qui tourne dans l'update de cette commande) : pas deux livraisons.
      select * into v_cmd from public.commandes c
       where c.id = v_id and c.tenant_id = p_tenant
       for update;
      if not found then
        resultat := 'refuse'; motif := 'Commande introuvable dans cette entreprise.';
      elsif not exists (select 1 from public.statuts s
                         where s.tenant_id = v_cmd.tenant_id
                           and (s.nom = v_cmd.statut_confirmation or s.code = v_cmd.statut_confirmation)
                           and (s.pays_id is null or s.pays_id = v_cmd.pays_id)
                           and s.declenche_assignation) then
        resultat := 'refuse'; motif := 'Commande pas confirmée : pas de livreur avant la confirmation.';
      elsif v_cmd.pays_id is distinct from v_liv.pays_id then
        resultat := 'refuse'; motif := format('%s ne livre pas dans le pays de cette commande.', v_liv.nom);
      else
        select string_agg(distinct v.statut, ', ') into v_bloque
          from public.livraisons v
         where v.commande_id = v_id and v.statut is distinct from 'a_preparer';
        if v_bloque is not null then
          resultat := 'refuse';
          motif := format('Livraison déjà %s : le livreur ne change plus.',
                          replace(replace(replace(replace(v_bloque,
                            'expedie', 'expédiée'), 'livre', 'livrée'), 'retour', 'en retour'), 'annule', 'annulée'));
        else
          select min(v.livreur_id::text)::uuid, count(*) into v_actuel, v_n
            from public.livraisons v where v.commande_id = v_id;
          if v_n = 0 then
            insert into public.livraisons (commande_id, livreur_id, tenant_id, statut)
            values (v_id, p_livreur, p_tenant, 'a_preparer');
            resultat := 'applique'; motif := null;
          elsif v_n = 1 and v_actuel = p_livreur then
            resultat := 'inchange'; motif := null;
          else
            update public.livraisons v set livreur_id = p_livreur
             where v.commande_id = v_id and v.statut = 'a_preparer'
               and v.livreur_id is distinct from p_livreur;
            resultat := 'applique'; motif := null;
          end if;
        end if;
      end if;
    exception when others then
      resultat := 'refuse'; motif := sqlerrm;
    end;
    return next;
  end loop;

  perform set_config('crm.affectation_lot', '', true);
end;
$$;

revoke all on function public.affecter_livreur_lot(uuid, uuid[], uuid) from public, anon;
grant execute on function public.affecter_livreur_lot(uuid, uuid[], uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 7. La vue : le seul chemin de lecture
-- -----------------------------------------------------------------------------
-- Même forme que v_historique_statuts (propriétaire, security_barrier), plus
-- fermée : super_admin tout ; admin, manager, ceo leur entreprise ; vendeur,
-- agent, livreur et les autres : AUCUNE ligne (l'agent et le livreur ne sont
-- jamais montrés au vendeur).
-- lot_taille : combien de commandes ce clic a déplacées.
create or replace view public.v_historique_affectations
with (security_invoker = off, security_barrier = true) as
select h.id,
       h.tenant_id,
       h.commande_id,
       (h.commande_id is null) as commande_supprimee,
       h.commande_lead_id,
       h.commande_tracking,
       h.commande_client,
       h.commande_produit,
       h.quoi,
       h.avant_id,
       h.avant_nom,
       h.apres_id,
       h.apres_nom,
       h.fait_par,
       h.fait_par_nom,
       h.via,
       h.lot_id,
       case when h.lot_id is not null then
         (select count(*) from public.historique_affectations x where x.lot_id = h.lot_id)
       end as lot_taille,
       h.cree_le
  from public.historique_affectations h
 where public.is_super_admin()
    or (h.tenant_id = public.get_my_tenant_id() and public.est_responsable());

revoke all on public.v_historique_affectations from public, anon, authenticated;
grant select on public.v_historique_affectations to authenticated;


-- -----------------------------------------------------------------------------
-- 8. Vérification
-- -----------------------------------------------------------------------------
do $$
declare
  r text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_historique_agent'
                    and tgrelid = 'public.commandes'::regclass and tgenabled <> 'D') then
    raise exception 'trg_historique_agent absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_historique_livreur'
                    and tgrelid = 'public.livraisons'::regclass and tgenabled <> 'D') then
    raise exception 'trg_historique_livreur absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_historique_affectations_garde'
                    and tgrelid = 'public.historique_affectations'::regclass and tgenabled <> 'D') then
    raise exception 'trg_historique_affectations_garde absent ou désactivé.';
  end if;
  -- 13/11 : seulement les clés vers commandes (et agents / livreurs) — le lien vers
  -- tenants (fk_entreprises.sql, 12/11) est RESTRICT exprès : une entreprise qui a
  -- un historique ne se supprime pas.
  if exists (select 1 from pg_constraint
              where conrelid = 'public.historique_affectations'::regclass
                and contype = 'f' and confrelid <> 'public.tenants'::regclass and confdeltype <> 'n') then
    raise exception 'historique_affectations : une clé n''est pas ON DELETE SET NULL.';
  end if;
  -- Le livreur se lit sur livraisons : aucune des fonctions ne doit lire le miroir.
  if exists (select 1 from pg_proc
              where pronamespace = 'public'::regnamespace
                and proname in ('affecter_livreur_lot', 'ecrire_historique_livreur', 'historiser_affectation')
                and prosrc like '%statut_livraison%') then
    raise exception 'Une fonction d''affectation lit commandes.statut_livraison (miroir faux) au lieu de livraisons.statut.';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.historique_affectations', 'select, insert, update, delete') then
      raise exception '% a encore un droit sur historique_affectations.', r;
    end if;
    if has_table_privilege(r, 'public.v_historique_affectations', 'insert, update, delete') then
      raise exception '% peut écrire dans v_historique_affectations.', r;
    end if;
    if has_function_privilege(r, 'public.historiser_affectation(text, public.commandes, uuid, uuid, boolean)', 'execute') then
      raise exception '% peut appeler historiser_affectation.', r;
    end if;
  end loop;
  foreach r in array array['affecter_agent_lot', 'affecter_livreur_lot'] loop
    if has_function_privilege('anon', format('public.%s(uuid, uuid[], uuid)', r), 'execute') then
      raise exception 'anon peut appeler %.', r;
    end if;
    if not has_function_privilege('authenticated', format('public.%s(uuid, uuid[], uuid)', r), 'execute') then
      raise exception 'authenticated ne peut pas appeler % : les écrans échoueraient.', r;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.v_historique_affectations', 'select') then
    raise exception 'anon peut lire v_historique_affectations.';
  end if;
  if exists (select 1 from pg_class where oid = 'public.v_historique_affectations'::regclass
                and coalesce(reloptions, '{}') @> array['security_invoker=on']) then
    raise exception 'v_historique_affectations doit tourner comme son propriétaire.';
  end if;
  raise notice 'historique_affectations.sql : en place. Aucune commande ni livraison modifiée.';
end $$;


-- -----------------------------------------------------------------------------
-- 9. Répétition générale : de VRAIES écritures, puis tout est annulé
-- -----------------------------------------------------------------------------
-- Dans l'entreprise de test (17144700…), jamais Fgmed Angola ; à défaut (base
-- de test), la première entreprise qui a un agent actif ET un livreur actif
-- dans le même pays. Avec le compte d'un manager/admin posé comme le fait
-- l'app (request.jwt.claims, le temps du bloc) :
--   1. une commande créée → ligne « creation » si un agent lui est donné ;
--   2. agent retiré à la main → ligne « navigateur » (après = vide) ;
--   3. affecter_agent_lot([la commande, une inconnue]) → 1 appliquée, 1
--      refusée, UNE ligne d'historique, via « affectation », lot_id posé ;
--      relancé → « inchange », aucune ligne de plus ;
--   4. la commande « Unreached » → le lot change aussi son agent (une ligne),
--      l'auteur de ses lignes de statut ne bouge pas ;
--   5. « Confirmed » (ville sans zone ni livreur : pas de livreur
--      automatique) → affecter_livreur_lot → livraison créée, ligne
--      « livreur » ; relancé → « inchange » ;
--   6. livraison « expédiée » → lot refusé, raison lue sur livraisons.statut ;
--   7. une ligne supprimée à la main → refusé ; la commande supprimée → ses
--      lignes restent, sans lien ;
--   8. la vue s'exécute.
-- Tout réussi : « REPETITION_OK » annule tout. Sinon le fichier s'arrête avec
-- la raison et rien n'est installé. Seule trace possible : le compteur des
-- numéros de tracking (FG…) avance d'un cran.
do $$
declare
  v_t     uuid;
  v_ag    public.agents;
  v_liv   public.livreurs;
  v_resp  uuid;
  v_c     uuid;
  v_lead  text := 'REPETITION-' || replace(gen_random_uuid()::text, '-', '');
  v_n     integer;
  v_r     record;
  v_ok    integer;
  v_ko    integer;
  v_msg   text;
  v_lot   uuid;
begin
  select a.tenant_id into v_t
    from public.agents a join public.livreurs l
      on l.tenant_id = a.tenant_id and l.pays_id = a.pays_id
   where a.actif and a.user_id is not null and l.actif is not false
   order by (a.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, a.tenant_id
   limit 1;
  if v_t is null then
    raise exception 'Répétition impossible : aucune entreprise avec un agent actif et un livreur actif du même pays.';
  end if;
  select l.* into v_liv from public.livreurs l
   where l.tenant_id = v_t and l.actif is not false and l.pays_id is not null
     and exists (select 1 from public.agents a where a.tenant_id = v_t and a.actif and a.user_id is not null and a.pays_id = l.pays_id)
   order by l.id limit 1;
  select a.* into v_ag from public.agents a
   where a.tenant_id = v_t and a.actif and a.user_id is not null and a.pays_id = v_liv.pays_id
   order by a.id limit 1;
  select ur.user_id into v_resp from public.user_roles ur left join public.roles r on r.id = ur.role_id
   where ur.tenant_id = v_t and coalesce(r.nom, ur.role) in ('admin', 'manager')
     and exists (select 1 from public.role_permissions rp
                  where rp.role_id = ur.role_id and rp.permission_code = 'assigner_livreur')
   order by ur.user_id limit 1;
  if v_resp is null then
    raise exception 'Répétition impossible : aucun manager/admin avec assigner_livreur dans l''entreprise %.', v_t;
  end if;

  begin
    -- Le compte du manager, comme une requête de l'app, le temps du bloc.
    perform set_config('request.jwt.claims', json_build_object('sub', v_resp, 'role', 'authenticated')::text, true);
    if auth.uid() is distinct from v_resp then
      raise exception 'impossible de poser le compte du manager pour la répétition';
    end if;

    -- 1. création
    insert into public.commandes (lead_id, tenant_id, pays_id, client_nom, client_telephone, produit, quantite, prix, ville_zone)
    values (v_lead, v_t, v_liv.pays_id, 'Répétition', '+000', 'Répétition', 1, 0, 'Répétition sans zone')
    returning id into v_c;
    select count(*) into v_n from public.historique_affectations where commande_id = v_c;
    if (select agent_id from public.commandes where id = v_c) is not null then
      if v_n <> 1 or not exists (select 1 from public.historique_affectations
                                  where commande_id = v_c and via = 'creation' and quoi = 'agent'
                                    and avant_id is null and commande_lead_id = v_lead) then
        raise exception 'création : pas de ligne « creation » correcte (% ligne(s))', v_n;
      end if;
    elsif v_n <> 0 then
      raise exception 'création sans agent : % ligne(s) au lieu de 0', v_n;
    end if;

    -- 2. agent retiré à la main (s'il y en avait un) → une ligne « navigateur »
    if (select agent_id from public.commandes where id = v_c) is not null then
      update public.commandes set agent_id = null where id = v_c;
      if (select count(*) from public.historique_affectations where commande_id = v_c) <> v_n + 1
         or not exists (select 1 from public.historique_affectations
                         where commande_id = v_c and via = 'navigateur' and apres_id is null
                           and avant_id is not null and fait_par = v_resp and fait_par_nom is not null) then
        raise exception 'retrait de l''agent : pas de ligne « navigateur » correcte';
      end if;
      v_n := v_n + 1;
    end if;

    -- 3. le lot : une bonne, une inconnue
    v_ok := 0; v_ko := 0;
    for v_r in select * from public.affecter_agent_lot(v_t, array[v_c, gen_random_uuid()], v_ag.id) loop
      if v_r.resultat = 'applique' and v_r.commande_id = v_c then v_ok := v_ok + 1;
      elsif v_r.resultat = 'refuse' and v_r.motif like 'Commande introuvable%' then v_ko := v_ko + 1;
      else raise exception 'lot agent : résultat inattendu % / % / %', v_r.commande_id, v_r.resultat, v_r.motif;
      end if;
    end loop;
    if v_ok <> 1 or v_ko <> 1 then
      raise exception 'lot agent : % appliquée(s), % refusée(s) au lieu de 1 et 1', v_ok, v_ko;
    end if;
    if (select agent_id from public.commandes where id = v_c) is distinct from v_ag.id then
      raise exception 'lot agent : l''agent n''a pas été posé';
    end if;
    select lot_id into v_lot from public.historique_affectations
     where commande_id = v_c and via = 'affectation' and quoi = 'agent'
       and apres_id = v_ag.id and fait_par = v_resp and lot_id is not null;
    if v_lot is null or (select count(*) from public.historique_affectations where commande_id = v_c) <> v_n + 1 then
      raise exception 'lot agent : pas exactement une ligne « affectation » avec son lot';
    end if;
    if coalesce(current_setting('crm.affectation_lot', true), '') <> '' then
      raise exception 'lot agent : le numéro de lot déborde sur la suite de la transaction';
    end if;
    select resultat into v_msg from public.affecter_agent_lot(v_t, array[v_c], v_ag.id);
    if v_msg <> 'inchange' or (select count(*) from public.historique_affectations where commande_id = v_c) <> v_n + 1 then
      raise exception 'lot agent relancé : attendu « inchange » sans ligne, obtenu %', v_msg;
    end if;
    v_n := v_n + 1;

    -- 4. lead traité (Unreached) → change d'agent aussi, une ligne ; ses
    --    lignes d'historique des statuts gardent leur auteur
    update public.commandes set agent_id = null where id = v_c;
    update public.commandes set statut_confirmation = 'Unreached' where id = v_c;
    select count(*) into v_n from public.historique_affectations where commande_id = v_c;
    select resultat, motif into v_r from public.affecter_agent_lot(v_t, array[v_c], v_ag.id);
    if v_r.resultat <> 'applique' then
      raise exception 'lead traité : attendu « applique », obtenu % (%)', v_r.resultat, v_r.motif;
    end if;
    if (select count(*) from public.historique_affectations where commande_id = v_c) <> v_n + 1 then
      raise exception 'lead traité : pas exactement une ligne d''historique';
    end if;
    if exists (select 1 from public.historique_statuts where commande_id = v_c and statut = 'Unreached'
                  and fait_par is distinct from v_resp) then
      raise exception 'lead traité : l''auteur d''une ligne de statut a changé avec l''agent';
    end if;

    -- 5. livreur
    update public.commandes set statut_confirmation = 'Confirmed', adresse = 'Répétition' where id = v_c;
    delete from public.livraisons where livraisons.commande_id = v_c; -- au cas où un livreur automatique l'aurait prise
    select count(*) into v_n from public.historique_affectations where commande_id = v_c;
    select resultat, motif into v_r from public.affecter_livreur_lot(v_t, array[v_c], v_liv.id);
    if v_r.resultat <> 'applique' then
      raise exception 'lot livreur : attendu « applique », obtenu % (%)', v_r.resultat, v_r.motif;
    end if;
    if not exists (select 1 from public.livraisons v where v.commande_id = v_c and v.livreur_id = v_liv.id and v.statut = 'a_preparer') then
      raise exception 'lot livreur : livraison non créée';
    end if;
    if (select count(*) from public.historique_affectations
         where commande_id = v_c and quoi = 'livreur' and via = 'affectation' and apres_id = v_liv.id
           and apres_nom is not distinct from nullif(btrim(v_liv.nom), '') and lot_id is not null) <> 1 then
      raise exception 'lot livreur : pas exactement une ligne « livreur »';
    end if;
    select resultat into v_msg from public.affecter_livreur_lot(v_t, array[v_c], v_liv.id);
    if v_msg <> 'inchange' then
      raise exception 'lot livreur relancé : attendu « inchange », obtenu %', v_msg;
    end if;

    -- 6. livraison partie → refusé (lu sur livraisons.statut)
    update public.livraisons set statut = 'expedie' where livraisons.commande_id = v_c;
    select count(*) into v_n from public.historique_affectations where commande_id = v_c;
    select motif into v_msg from public.affecter_livreur_lot(v_t, array[v_c], v_liv.id);
    if v_msg is null or v_msg not like 'Livraison déjà expédiée%' then
      raise exception 'livraison expédiée : attendu un refus, obtenu « % »', coalesce(v_msg, 'accepté');
    end if;
    if (select count(*) from public.historique_affectations where commande_id = v_c) <> v_n then
      raise exception 'livraison expédiée : un refus a écrit une ligne';
    end if;

    -- 7. garde, puis suppression de la commande
    begin
      delete from public.historique_affectations where historique_affectations.commande_id = v_c;
      raise exception 'GARDE_ABSENTE';
    exception when others then
      if sqlerrm = 'GARDE_ABSENTE' then
        raise exception 'garde : une ligne d''historique a pu être supprimée';
      end if;
    end;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.historique_affectations where commande_id = v_c;
    delete from public.appels where appels.commande_id = v_c;
    delete from public.livraisons where livraisons.commande_id = v_c;
    delete from public.commandes where id = v_c;
    if (select count(*) from public.historique_affectations
         where commande_lead_id = v_lead and commande_id is null and tenant_id = v_t) <> v_n then
      raise exception 'suppression de la commande : ses lignes n''ont pas toutes été gardées';
    end if;

    -- 8. la vue
    perform count(*) from public.v_historique_affectations;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'historique_affectations.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;

  if exists (select 1 from public.historique_affectations where commande_lead_id = v_lead)
     or exists (select 1 from public.commandes where lead_id = v_lead) then
    raise exception 'Répétition : des écritures sont restées (elles auraient dû être annulées).';
  end if;
  raise notice 'historique_affectations.sql : répétition réussie (création, retrait, lot agent, refus, lot livreur, refus livraison partie, garde, suppression), tout annulé.';
end $$;

-- Ce qui est en place (à lire) :
select quoi, via, count(*) as lignes from public.historique_affectations group by quoi, via order by quoi, via;
