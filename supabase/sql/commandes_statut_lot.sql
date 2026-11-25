-- =============================================================================
-- Commandes : suivi des statuts sur la commande + changement de statut par lot
-- 29/10/2026
-- =============================================================================
--
-- CE QUE FAIT CE FICHIER :
--   §1  arrêt si les prérequis manquent ;
--   §2  historique_statuts.lot_id + via « lot » ;
--   §3  LA définition d'une tentative (est_tentative) et le suivi d'une
--       commande calculé depuis son historique (suivi_statuts) ;
--   §4  quatre colonnes sur commandes, écrites par la base seule :
--         nb_tentatives, derniere_tentative_statut, derniere_tentative_le,
--         derniere_action_le ;
--   §5  le trigger d'historique (nouveau corps de ecrire_historique_statut) :
--       sait écrire une ligne de lot (motif, lot_id), et recalcule le suivi
--       de la commande après chaque ligne ;
--   §6  NOUVEAU REFUS : un statut OUVERT (Non joint, Rappel…) sur une commande
--       qu'un livreur a déjà — même règle que le retour à « Pending » ;
--   §7  changer_statut_lot(entreprise, ids, statut, motif, date_rappel) ;
--   §8  la vue v_historique_statuts expose lot_id ;
--   §9  remplissage des colonnes depuis l'historique existant (SEULE écriture
--       sur des commandes existantes : les quatre colonnes de suivi) ;
--   §10 vérification ; §11 répétition (de vraies écritures, annulées).
--
-- UNE SEULE DÉFINITION DE « TENTATIVE » (sa décision du 29/10) : une ligne
-- d'historique vers un statut OUVERT autre que Pending (ferme_le_lead faux,
-- lu dans Paramètres → Statuts), QUI NE VIENT PAS D'UN LOT. Personne n'a
-- appelé pendant un changement par lot : ce chiffre mesure si les agents
-- appellent. Elle est ici (est_tentative) et nulle part ailleurs : la page lit
-- les colonnes, la fonction JS estTentative / resumeTentatives est retirée.
-- Comparé le 29/10 sur les 136 commandes de production, lecture seule : la
-- ligne « ☎ … tentatives » calculée par cette définition = celle affichée
-- aujourd'hui, 136/136.
--
-- §6, À SAVOIR : jusqu'ici RIEN ne refusait de mettre « Non joint » ou
-- « Rappel » sur une commande qu'un livreur avait, pas même un changement
-- seul (seul le retour à Pending était gardé). Ce refus vaut pour TOUS les
-- chemins : Commandes, et aussi le panneau d'appel de l'agent (une
-- confirmée en « suivi » qu'il remettrait « Non joint »). 0 commande dans ce
-- cas le 29/10 : aucune ligne existante ne le contredit.
--
-- ORDRE : ce fichier, PUIS les pages (Commandes, Centre d'appel). Aucun
-- déploiement. Retour arrière : commandes_statut_lot_retour.sql
-- (copie : ~/Desktop/RETOUR_commandes_statut_lot.sql).
-- Exécutable en entier, et deux fois.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Prérequis
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.historique_statuts') is null
     or not exists (select 1 from pg_trigger where tgname = 'trg_historique_statut') then
    raise exception 'Lancez d''abord historique_statuts.sql. Rien n''a été installé.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'commandes' and column_name = 'entree_file') then
    raise exception 'Lancez d''abord renvoyer_en_attente.sql. Rien n''a été installé.';
  end if;
  if to_regprocedure('public.a_la_permission(text)') is null then
    raise exception 'public.a_la_permission(text) manque (rls_sources_import.sql) : « Actions en masse » ne pourrait pas être lue. Rien n''a été installé.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. historique_statuts : le lot
-- -----------------------------------------------------------------------------
-- Ajouter une colonne ne touche aucune ligne (la garde n'est pas appelée).
alter table public.historique_statuts add column if not exists lot_id uuid;
create index if not exists idx_historique_statuts_lot
  on public.historique_statuts (lot_id) where lot_id is not null;

alter table public.historique_statuts drop constraint if exists historique_statuts_via_check;
alter table public.historique_statuts add constraint historique_statuts_via_check
  check (via in ('confirmer-appel', 'navigateur', 'systeme', 'migration', 'lot'));


-- -----------------------------------------------------------------------------
-- 3. Une tentative ; le suivi d'une commande
-- -----------------------------------------------------------------------------
-- Statut OUVERT : « Pending », ou un statut de l'entreprise dont
-- ferme_le_lead est faux. Lu sur le drapeau, jamais sur le mot.
create or replace function public.est_statut_ouvert(p_tenant uuid, p_statut text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_statut is null or p_statut = 'Pending'
      or exists (select 1 from public.statuts s
                  where s.tenant_id = p_tenant and s.nom = p_statut and not s.ferme_le_lead)
$$;

-- LA définition (voir l'en-tête). Une ligne d'historique est une tentative
-- si elle mène à un statut ouvert autre que Pending ET ne vient pas d'un lot.
-- GARDE (02/11) : est_tentative est définie aujourd'hui par delai_prise_en_charge.sql
-- (réécrite sur est_prise_en_charge, mêmes réponses prouvées). Ce fichier ne la
-- réécrit que si elle manque, n'a pas de marque, porte la sienne ou celle d'un
-- fichier plus ancien. Marquée par un fichier plus récent → gardée, avec un avis.
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.est_tentative(uuid, text, uuid)'), 'pg_proc');
begin
  if v_marque in ('fichier: delai_prise_en_charge.sql') then
    raise notice 'commandes_statut_lot.sql : est_tentative gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.est_tentative(p_tenant uuid, p_statut text, p_lot uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_lot is null
     and p_statut is not null and p_statut <> 'Pending'
     and public.est_statut_ouvert(p_tenant, p_statut)
$$
$def$;
  comment on function public.est_tentative(uuid, text, uuid) is 'fichier: commandes_statut_lot.sql';
end $garde$;

-- Le suivi d'une commande, recalculé depuis son historique — jamais
-- incrémenté : un compteur qu'on incrémente dérive ; celui-ci se recompte.
create or replace function public.suivi_statuts(p_commande uuid)
returns table (nb_tentatives integer, derniere_tentative_statut text,
               derniere_tentative_le timestamptz, derniere_action_le timestamptz)
language sql stable security definer set search_path = public
as $$
  with h as (
    select h.statut, h.cree_le, h.id,
           public.est_tentative(h.tenant_id, h.statut, h.lot_id) as tentative
      from public.historique_statuts h
     where h.commande_id = p_commande
  )
  select (select count(*)::integer from h where tentative),
         (select statut  from h where tentative order by cree_le desc, id desc limit 1),
         (select cree_le from h where tentative order by cree_le desc, id desc limit 1),
         (select max(cree_le) from h)
$$;

revoke all on function public.est_statut_ouvert(uuid, text) from public, anon;
revoke all on function public.est_tentative(uuid, text, uuid) from public, anon;
revoke all on function public.suivi_statuts(uuid) from public, anon, authenticated;
grant execute on function public.est_statut_ouvert(uuid, text) to authenticated;
grant execute on function public.est_tentative(uuid, text, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. Les colonnes de suivi sur commandes
-- -----------------------------------------------------------------------------
alter table public.commandes add column if not exists nb_tentatives integer not null default 0;
alter table public.commandes add column if not exists derniere_tentative_statut text;
alter table public.commandes add column if not exists derniere_tentative_le timestamptz;
alter table public.commandes add column if not exists derniere_action_le timestamptz;
-- Pas d'index sur nb_tentatives : on ne filtre pas dessus (sa décision du
-- 29/10, filtre « Nombre des appels » retiré). La colonne reste : la ligne
-- « ☎ Non joint — 3 tentatives » du badge la lit.
create index if not exists idx_commandes_derniere_action on public.commandes (tenant_id, derniere_action_le);

-- Écrire le suivi d'une commande : SEUL chemin d'écriture des quatre colonnes.
create or replace function public.recalculer_suivi_statuts(p_commande uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform set_config('crm.suivi_recalcul', 'oui', true);
  update public.commandes c
     set nb_tentatives = s.nb_tentatives,
         derniere_tentative_statut = s.derniere_tentative_statut,
         derniere_tentative_le = s.derniere_tentative_le,
         derniere_action_le = s.derniere_action_le
    from public.suivi_statuts(p_commande) s
   where c.id = p_commande
     and (c.nb_tentatives, c.derniere_tentative_statut, c.derniere_tentative_le, c.derniere_action_le)
         is distinct from
         (s.nb_tentatives, s.derniere_tentative_statut, s.derniere_tentative_le, s.derniere_action_le);
  perform set_config('crm.suivi_recalcul', '', true);
end;
$$;
revoke all on function public.recalculer_suivi_statuts(uuid) from public, anon, authenticated;

-- La garde : personne n'écrit ces colonnes à la main (navigateur, clé
-- service, éditeur SQL compris). À l'insertion, ce qui est envoyé est
-- ignoré (le trigger d'historique les recalcule juste après).
create or replace function public.suivi_statuts_garde()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('crm.suivi_recalcul', true), '') = 'oui' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.nb_tentatives := 0;
    new.derniere_tentative_statut := null;
    new.derniere_tentative_le := null;
    new.derniere_action_le := null;
    return new;
  end if;
  if (new.nb_tentatives, new.derniere_tentative_statut, new.derniere_tentative_le, new.derniere_action_le)
     is distinct from
     (old.nb_tentatives, old.derniere_tentative_statut, old.derniere_tentative_le, old.derniere_action_le) then
    raise exception 'Le suivi des appels d''une commande (tentatives, dernière action) se calcule depuis son historique : il ne s''écrit pas à la main.';
  end if;
  return new;
end;
$$;

create or replace trigger trg_suivi_statuts_garde
  before insert or update of nb_tentatives, derniere_tentative_statut, derniere_tentative_le, derniere_action_le
  on public.commandes
  for each row execute function public.suivi_statuts_garde();


-- -----------------------------------------------------------------------------
-- 5. Le trigger d'historique (corps de production du 28/10 + le lot + le suivi)
-- -----------------------------------------------------------------------------
-- Ajouts au corps de historique_statuts.sql §4 (vérifié identique à la
-- production le 29/10), et rien d'autre :
--   · un changement posé par changer_statut_lot (réglage local
--     crm.statut_lot) : via « lot », lot_id, le motif (crm.historique_note),
--     qui = le compte connecté ;
--   · après la ligne, le suivi de la commande est recalculé.
create or replace function public.ecrire_historique_statut()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_via    text;
  v_acteur uuid;
  v_note   text;
  v_duree  integer;
  v_appel  uuid;
  v_nom    text;
  v_lot    uuid := nullif(current_setting('crm.statut_lot', true), '')::uuid;
begin
  if tg_op = 'UPDATE'
     and new.statut_confirmation is not distinct from old.statut_confirmation then
    return null; -- adresse corrigée, statut inchangé : pas un changement
  end if;

  if v_lot is not null then
    v_via := 'lot';
    v_acteur := coalesce(v_uid, nullif(current_setting('crm.historique_acteur', true), '')::uuid);
    v_note := nullif(current_setting('crm.historique_note', true), '');
  elsif v_uid is not null then
    v_via := 'navigateur';
    v_acteur := v_uid;
  elsif coalesce(current_setting('crm.historique_via', true), '') = 'confirmer-appel' then
    v_via := 'confirmer-appel';
    v_acteur := nullif(current_setting('crm.historique_acteur', true), '')::uuid;
    v_note   := nullif(current_setting('crm.historique_note', true), '');
    v_duree  := nullif(current_setting('crm.historique_duree', true), '')::integer;
    v_appel  := nullif(current_setting('crm.historique_appel', true), '')::uuid;
  else
    v_via := 'systeme';
  end if;

  if v_acteur is not null then
    select coalesce(
             (select nullif(btrim(a.nom), '') from public.agents a
               where a.user_id = v_acteur and a.tenant_id = new.tenant_id limit 1),
             (select nullif(btrim(ur.nom), '') from public.user_roles ur
               where ur.user_id = v_acteur limit 1),
             (select ur.email from public.user_roles ur
               where ur.user_id = v_acteur limit 1))
      into v_nom;
  end if;

  insert into public.historique_statuts
    (tenant_id, commande_id, vendeur_id,
     commande_lead_id, commande_tracking, commande_client, commande_produit,
     statut_precedent, statut,
     fait_par, fait_par_nom, note, duree_secondes, via, appel_id, lot_id)
  values
    (new.tenant_id, new.id, new.vendeur_id,
     new.lead_id, new.tracking_number, new.client_nom, new.produit,
     case when tg_op = 'UPDATE' then old.statut_confirmation end,
     new.statut_confirmation,
     v_acteur, v_nom, v_note, v_duree, v_via, v_appel, v_lot);

  perform public.recalculer_suivi_statuts(new.id);
  return null;
end;
$$;
-- Marque (02/11) : ce fichier définit ecrire_historique_statut. Les fichiers plus anciens qui
-- en ont une copie la lisent et ne la réécrivent plus.
comment on function public.ecrire_historique_statut() is 'fichier: commandes_statut_lot.sql';

revoke all on function public.ecrire_historique_statut() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 6. Un statut ouvert sur une commande qu'un livreur a : refusé
-- -----------------------------------------------------------------------------
-- Le retour à Pending a sa règle (renvoyer_en_attente.sql §4) : ce trigger le
-- laisse passer et ne s'occupe que des AUTRES statuts ouverts. Lu sur
-- `livraisons` (jamais sur commandes.statut_livraison, miroir faux). Tout
-- chemin, personne n'est exempté — comme la règle de Pending.
-- Nommé « ab » : juste après trg_aa_statut_pending.
create or replace function public.statut_ouvert_sans_livreur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liv record;
begin
  if new.statut_confirmation is not distinct from old.statut_confirmation
     or new.statut_confirmation = 'Pending'
     or not exists (select 1 from public.statuts s
                     where s.tenant_id = new.tenant_id and s.nom = new.statut_confirmation
                       and not s.ferme_le_lead
                       and (s.pays_id is null or s.pays_id = new.pays_id)) then
    return new;
  end if;

  select l.statut, coalesce(nullif(btrim(lv.nom), ''), 'sans nom') as livreur
    into v_liv
    from public.livraisons l left join public.livreurs lv on lv.id = l.livreur_id
   where l.commande_id = new.id
   order by l.created_at desc nulls last
   limit 1;
  if found then
    raise exception 'Statut « % » refusé : le livreur % a cette commande (livraison %). Un litige sur la livraison se règle dans Livraisons.',
      case new.statut_confirmation when 'Unreached' then 'Non joint' when 'Reminder' then 'Rappel' else new.statut_confirmation end,
      v_liv.livreur,
      case v_liv.statut when 'a_preparer' then 'à préparer' when 'expedie' then 'expédiée' when 'livre' then 'livrée'
                        when 'retour' then 'en retour' when 'annule' then 'annulée' else coalesce(v_liv.statut, '?') end;
  end if;
  return new;
end;
$$;
revoke all on function public.statut_ouvert_sans_livreur() from public, anon, authenticated;

create or replace trigger trg_ab_statut_ouvert_livreur
  before update of statut_confirmation on public.commandes
  for each row execute function public.statut_ouvert_sans_livreur();


-- -----------------------------------------------------------------------------
-- 7. changer_statut_lot(entreprise, ids, statut, motif, date_rappel)
-- -----------------------------------------------------------------------------
-- LA porte de Commandes pour En attente, Non joint, Rappel — une commande
-- seule (le tiroir) comme cinquante (la sélection).
-- Qui : admin, manager de CETTE entreprise, super_admin.
-- Refus de TOUT le lot (rien n'est écrit) :
--   · pas connecté, pas le droit, plus de 500 commandes ;
--   · statut ni « Pending » ni un statut ouvert de l'entreprise ;
--   · Pending sans motif (motif obligatoire, comme « Renvoyer en attente ») ;
--   · Rappel sans heure, heure passée, ou au-delà de 30 jours
--     (_shared/appel.ts : RAPPEL_MAX_JOURS, RAPPEL_TOLERANCE_MS — même règle).
-- Refus d'UNE ligne, avec la raison :
--   · commande introuvable dans l'entreprise ;
--   · statut d'un autre pays que la commande ;
--   · un livreur a la commande (Pending : renvoyer_en_attente.sql §4 ; les
--     autres : §6 ci-dessus) — refusé par la BASE, le texte est rendu tel quel ;
--   · toute autre erreur de la base sur cette ligne.
-- Chaque ligne appliquée : une ligne d'historique, via « lot », lot_id
-- commun, le motif. Aucune ligne dans `appels` : personne n'a appelé.
create or replace function public.changer_statut_lot(
  p_tenant uuid, p_ids uuid[], p_statut text, p_motif text, p_date_rappel timestamptz
)
returns table (commande_id uuid, resultat text, motif text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rappel boolean;
  v_note   text;
  v_id     uuid;
  v_cmd    public.commandes;
  v_motif  text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if not (public.is_super_admin()
          or (lower(coalesce(public.mon_role(), '')) in ('admin', 'manager')
              and p_tenant = public.get_my_tenant_id())) then
    raise exception 'Seuls un manager ou un admin de cette entreprise changent le statut d''une commande.' using errcode = '42501';
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
  if p_statut is null or not public.est_statut_ouvert(p_tenant, p_statut) then
    raise exception 'Seuls En attente, Non joint et Rappel (les statuts ouverts) se changent par lot.';
  end if;

  if p_statut = 'Pending' then
    if v_motif is null then
      raise exception 'Le motif est obligatoire pour renvoyer une commande en attente.';
    end if;
    v_note := 'Renvoyé en attente : ' || v_motif;
  else
    v_note := coalesce(v_motif, 'Statut corrigé depuis Commandes');
  end if;

  v_rappel := exists (select 1 from public.statuts s
                       where s.tenant_id = p_tenant and s.nom = p_statut and s.necessite_rappel);
  if v_rappel then
    if p_date_rappel is null then
      raise exception 'Choisissez la date et l''heure du rappel : sans elles, le lead ne remonte jamais dans la file.';
    end if;
    if p_date_rappel < now() - interval '2 minutes' then
      raise exception 'Cette heure de rappel est déjà passée : choisissez un moment à venir.';
    end if;
    if p_date_rappel > now() + interval '30 days' then
      raise exception 'Un rappel se fixe à 30 jours au plus. Au-delà, ce n''est plus un rappel : annulez, le client reviendra.';
    end if;
  end if;

  perform set_config('crm.statut_lot', gen_random_uuid()::text, true);
  perform set_config('crm.historique_note', v_note, true);

  for v_id in select distinct x from unnest(p_ids) as x where x is not null loop
    commande_id := v_id;
    begin
      select * into v_cmd from public.commandes c
       where c.id = v_id and c.tenant_id = p_tenant
       for update;
      if not found then
        resultat := 'refuse'; motif := 'Commande introuvable dans cette entreprise.';
      elsif v_cmd.statut_confirmation is not distinct from p_statut then
        resultat := 'inchange'; motif := null;
      elsif p_statut <> 'Pending' and not exists (
              select 1 from public.statuts s
               where s.tenant_id = p_tenant and s.nom = p_statut
                 and (s.pays_id is null or s.pays_id = v_cmd.pays_id)) then
        resultat := 'refuse'; motif := 'Ce statut ne s''applique pas au pays de cette commande.';
      else
        update public.commandes c
           set statut_confirmation = p_statut,
               date_rappel = case when v_rappel then p_date_rappel end,
               updated_at = now()
         where c.id = v_id;
        resultat := 'applique'; motif := null;
      end if;
    exception when others then
      -- La ligne seule est annulée (son historique avec elle).
      resultat := 'refuse'; motif := sqlerrm;
    end;
    return next;
  end loop;

  perform set_config('crm.statut_lot', '', true);
  perform set_config('crm.historique_note', '', true);
end;
$$;

revoke all on function public.changer_statut_lot(uuid, uuid[], text, text, timestamptz) from public, anon;
grant execute on function public.changer_statut_lot(uuid, uuid[], text, text, timestamptz) to authenticated;


-- -----------------------------------------------------------------------------
-- 8. La vue : lot_id en plus (même définition que la production, colonne ajoutée à la fin)
-- -----------------------------------------------------------------------------
create or replace view public.v_historique_statuts
with (security_invoker = off, security_barrier = true) as
select h.id,
       h.tenant_id,
       h.commande_id,
       (h.commande_id is null)  as commande_supprimee,
       h.commande_lead_id,
       h.commande_tracking,
       h.commande_client,
       h.commande_produit,
       h.statut_precedent,
       h.statut,
       case when public.is_super_admin() or public.est_responsable() then h.fait_par end     as fait_par,
       case when public.is_super_admin() or public.est_responsable() then h.fait_par_nom end as fait_par_nom,
       h.note,
       h.duree_secondes,
       h.via,
       h.cree_le,
       h.lot_id
  from public.historique_statuts h
 where public.is_super_admin()
    or (h.tenant_id = public.get_my_tenant_id()
        and (public.est_responsable()
             or (public.mon_role() = 'seller'
                 and coalesce((select c.vendeur_id from public.commandes c
                                where c.id = h.commande_id),
                              h.vendeur_id) = auth.uid())));
-- Marque (02/11) : ce fichier définit v_historique_statuts (avec lot_id).
-- historique_statuts.sql la lit et ne la réécrit plus.
comment on view public.v_historique_statuts is 'fichier: commandes_statut_lot.sql';

revoke all on public.v_historique_statuts from public, anon, authenticated;
grant select on public.v_historique_statuts to authenticated;


-- -----------------------------------------------------------------------------
-- 9. Remplissage depuis l'historique existant (rejouable)
-- -----------------------------------------------------------------------------
-- Ne touche QUE les quatre colonnes de suivi (updated_at reste ce qu'il est).
create or replace function public.remplir_suivi_statuts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
begin
  perform set_config('crm.suivi_recalcul', 'oui', true);
  update public.commandes c
     set nb_tentatives = s.nb_tentatives,
         derniere_tentative_statut = s.derniere_tentative_statut,
         derniere_tentative_le = s.derniere_tentative_le,
         derniere_action_le = s.derniere_action_le
    from (select c2.id as commande, x.*
            from public.commandes c2 cross join lateral public.suivi_statuts(c2.id) x) s
   where c.id = s.commande
     and (c.nb_tentatives, c.derniere_tentative_statut, c.derniere_tentative_le, c.derniere_action_le)
         is distinct from
         (s.nb_tentatives, s.derniere_tentative_statut, s.derniere_tentative_le, s.derniere_action_le);
  get diagnostics v_n = row_count;
  perform set_config('crm.suivi_recalcul', '', true);
  return v_n;
end;
$$;
revoke all on function public.remplir_suivi_statuts() from public, anon, authenticated;

do $$
declare v_n integer;
begin
  v_n := public.remplir_suivi_statuts();
  raise notice 'commandes_statut_lot.sql : suivi rempli sur % commande(s) (les quatre colonnes de suivi seulement).', v_n;
end $$;


-- -----------------------------------------------------------------------------
-- 10. Vérification
-- -----------------------------------------------------------------------------
do $$
declare
  v_ecart integer;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_historique_statut' and tgenabled <> 'D') then
    raise exception 'trg_historique_statut absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_ab_statut_ouvert_livreur' and tgenabled <> 'D') then
    raise exception 'trg_ab_statut_ouvert_livreur absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_suivi_statuts_garde' and tgenabled <> 'D') then
    raise exception 'trg_suivi_statuts_garde absent ou désactivé.';
  end if;
  -- Chaque commande : ses colonnes = son historique recompté.
  select count(*) into v_ecart
    from public.commandes c cross join lateral public.suivi_statuts(c.id) s
   where (c.nb_tentatives, c.derniere_tentative_statut, c.derniere_tentative_le, c.derniere_action_le)
         is distinct from
         (s.nb_tentatives, s.derniere_tentative_statut, s.derniere_tentative_le, s.derniere_action_le);
  if v_ecart > 0 then
    raise exception '% commande(s) dont le suivi ne correspond pas à l''historique.', v_ecart;
  end if;
  if has_function_privilege('anon', 'public.changer_statut_lot(uuid, uuid[], text, text, timestamptz)', 'execute') then
    raise exception 'anon peut appeler changer_statut_lot.';
  end if;
  if not has_function_privilege('authenticated', 'public.changer_statut_lot(uuid, uuid[], text, text, timestamptz)', 'execute') then
    raise exception 'authenticated ne peut pas appeler changer_statut_lot : la page échouerait.';
  end if;
  if has_function_privilege('authenticated', 'public.recalculer_suivi_statuts(uuid)', 'execute') then
    raise exception 'authenticated peut appeler recalculer_suivi_statuts.';
  end if;
  raise notice 'commandes_statut_lot.sql : en place ; suivi = historique pour toutes les commandes.';
end $$;


-- -----------------------------------------------------------------------------
-- 11. Répétition générale : de VRAIES écritures, puis tout est annulé
-- -----------------------------------------------------------------------------
-- Dans l'entreprise de test (17144700…) si elle a un manager/admin et un
-- pays, sinon la première qui les a. Deux commandes créées, le compte du
-- manager posé comme le fait l'app, puis :
--   1. naissance : 0 tentative, dernière action posée ;
--   2. lot → Non joint (deux commandes) : appliqué, une ligne d'historique
--      chacune, même lot_id, motif ; AUCUNE tentative comptée ;
--   3. un vrai appel (enregistrer_appel, comme confirmer-appel) → Rappel :
--      1 tentative, dernier mot « Reminder » ;
--   4. lot → Pending sans motif : tout refusé ; avec motif : appliqué, note
--      « Renvoyé en attente : … » ;
--   5. lot → Rappel sans heure / à 40 jours : refusé ;
--   6. confirmée + livraison : lot → Non joint refusé en nommant le livreur ;
--      update direct (chemin de l'agent) refusé aussi ;
--   7. écrire nb_tentatives à la main : refusé ;
--   8. colonnes = historique recompté.
-- Tout réussi : « REPETITION_OK » annule tout. Sinon le fichier s'arrête et
-- rien n'est installé. Trace possible : les compteurs de tracking (FG…).
do $$
declare
  v_t    uuid;
  v_p    uuid;
  v_resp uuid;
  v_liv  uuid;
  v_c1   uuid;
  v_c2   uuid;
  v_lead text := 'REPETITION-' || replace(gen_random_uuid()::text, '-', '');
  v_r    record;
  v_n    integer;
  v_msg  text;
  v_lots integer;
  v_unreached text;
  v_reminder  text;
begin
  select p.tenant_id, p.id into v_t, v_p
    from public.pays p
   where exists (select 1 from public.user_roles ur where ur.tenant_id = p.tenant_id and ur.role in ('admin', 'manager'))
     and exists (select 1 from public.statuts s where s.tenant_id = p.tenant_id and s.necessite_rappel and not s.ferme_le_lead)
     and exists (select 1 from public.statuts s where s.tenant_id = p.tenant_id and not s.necessite_rappel and not s.ferme_le_lead and s.nom <> 'Pending')
     and exists (select 1 from public.statuts s where s.tenant_id = p.tenant_id and s.declenche_assignation)
   order by (p.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, p.tenant_id, p.nom
   limit 1;
  select ur.user_id into v_resp from public.user_roles ur
   where ur.tenant_id = v_t and ur.role in ('admin', 'manager') order by ur.user_id limit 1;
  select l.id into v_liv from public.livreurs l where l.tenant_id = v_t order by l.id limit 1;
  select s.nom into v_unreached from public.statuts s
   where s.tenant_id = v_t and not s.ferme_le_lead and not s.necessite_rappel and s.nom <> 'Pending' and s.pays_id is null order by s.nom limit 1;
  select s.nom into v_reminder from public.statuts s
   where s.tenant_id = v_t and not s.ferme_le_lead and s.necessite_rappel and s.pays_id is null order by s.nom limit 1;
  if v_t is null or v_resp is null or v_unreached is null or v_reminder is null then
    raise exception 'Répétition impossible : aucune entreprise avec un pays, un manager/admin et les statuts standard.';
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_resp, 'role', 'authenticated')::text, true);
    if auth.uid() is distinct from v_resp then raise exception 'impossible de poser le compte du manager'; end if;

    -- 1. naissance
    insert into public.commandes (lead_id, tenant_id, pays_id, client_nom, client_telephone, produit, quantite, prix, ville_zone, nb_tentatives)
    values (v_lead, v_t, v_p, 'Répétition', '+000', 'Répétition', 1, 0, 'Répétition sans zone', 99) returning id into v_c1;
    insert into public.commandes (lead_id, tenant_id, pays_id, client_nom, client_telephone, produit, quantite, prix, ville_zone)
    values (v_lead || '-2', v_t, v_p, 'Répétition', '+000', 'Répétition', 1, 0, 'Répétition sans zone') returning id into v_c2;
    if (select nb_tentatives from public.commandes where id = v_c1) <> 0
       or (select derniere_action_le from public.commandes where id = v_c1) is null then
      raise exception 'naissance : suivi faux (une valeur envoyée à la main a-t-elle été gardée ?)';
    end if;

    -- 2. lot → Non joint
    v_n := 0;
    for v_r in select * from public.changer_statut_lot(v_t, array[v_c1, v_c2], v_unreached, 'motif de répétition', null) loop
      if v_r.resultat <> 'applique' then raise exception 'lot Non joint : % (%)', v_r.resultat, v_r.motif; end if;
      v_n := v_n + 1;
    end loop;
    if v_n <> 2 then raise exception 'lot Non joint : % réponse(s) au lieu de 2', v_n; end if;
    select count(distinct lot_id) into v_lots from public.historique_statuts
     where commande_id in (v_c1, v_c2) and via = 'lot' and statut = v_unreached and note = 'motif de répétition' and fait_par = v_resp;
    if v_lots <> 1 or (select count(*) from public.historique_statuts where commande_id in (v_c1, v_c2) and via = 'lot') <> 2 then
      raise exception 'lot Non joint : pas deux lignes « lot » avec le même lot_id';
    end if;
    if (select nb_tentatives from public.commandes where id = v_c1) <> 0 then
      raise exception 'lot Non joint : un changement par lot a été compté comme tentative';
    end if;
    if coalesce(current_setting('crm.statut_lot', true), '') <> '' then
      raise exception 'le numéro de lot déborde sur la suite de la transaction';
    end if;

    -- 3. un vrai appel → Rappel
    perform public.enregistrer_appel(v_c1, v_t, v_resp, null, v_reminder, v_unreached, 'appel de répétition', 9, now() + interval '1 day', '{}'::jsonb);
    if (select nb_tentatives from public.commandes where id = v_c1) <> 1
       or (select derniere_tentative_statut from public.commandes where id = v_c1) <> v_reminder then
      raise exception 'vrai appel : la tentative n''a pas été comptée';
    end if;

    -- 4. Pending
    v_msg := null;
    begin perform * from public.changer_statut_lot(v_t, array[v_c1], 'Pending', '  ', null);
    exception when others then v_msg := sqlerrm; end;
    if v_msg is null or v_msg not like 'Le motif est obligatoire%' then
      raise exception 'Pending sans motif : attendu un refus, obtenu « % »', coalesce(v_msg, 'accepté');
    end if;
    select resultat into v_msg from public.changer_statut_lot(v_t, array[v_c1], 'Pending', 'erreur de saisie', null);
    if v_msg <> 'applique' or not exists (select 1 from public.historique_statuts
                                          where commande_id = v_c1 and statut = 'Pending' and note = 'Renvoyé en attente : erreur de saisie') then
      raise exception 'Pending avec motif : pas appliqué ou note absente (%)', v_msg;
    end if;

    -- 5. Rappel sans heure, trop loin
    v_msg := null;
    begin perform * from public.changer_statut_lot(v_t, array[v_c2], v_reminder, null, null);
    exception when others then v_msg := sqlerrm; end;
    if v_msg is null then raise exception 'Rappel sans heure : attendu un refus'; end if;
    v_msg := null;
    begin perform * from public.changer_statut_lot(v_t, array[v_c2], v_reminder, null, now() + interval '40 days');
    exception when others then v_msg := sqlerrm; end;
    if v_msg is null or v_msg not like 'Un rappel se fixe à 30 jours%' then
      raise exception 'Rappel à 40 jours : attendu un refus, obtenu « % »', coalesce(v_msg, 'accepté');
    end if;

    -- 6. un livreur a la commande
    if v_liv is not null then
      update public.commandes set statut_confirmation = (select s.nom from public.statuts s where s.tenant_id = v_t and s.declenche_assignation order by s.nom limit 1),
                                  adresse = 'Répétition' where id = v_c2;
      delete from public.livraisons where livraisons.commande_id = v_c2;
      insert into public.livraisons (commande_id, livreur_id, tenant_id, statut) values (v_c2, v_liv, v_t, 'a_preparer');
      select motif into v_msg from public.changer_statut_lot(v_t, array[v_c2], v_unreached, null, null);
      if v_msg is null or v_msg not like 'Statut « Non joint » refusé : le livreur % a cette commande (livraison à préparer)%'
         and v_msg not like 'Statut « % » refusé : le livreur % a cette commande%' then
        raise exception 'lot avec livreur : attendu un refus nommant le livreur, obtenu « % »', coalesce(v_msg, 'accepté');
      end if;
      v_msg := null;
      begin update public.commandes set statut_confirmation = v_unreached where id = v_c2;
      exception when others then v_msg := sqlerrm; end;
      if v_msg is null or v_msg not like 'Statut « % » refusé : le livreur%' then
        raise exception 'update direct avec livreur : attendu un refus, obtenu « % »', coalesce(v_msg, 'accepté');
      end if;
    end if;

    -- 7. écriture à la main
    v_msg := null;
    begin update public.commandes set nb_tentatives = 7 where id = v_c1;
    exception when others then v_msg := sqlerrm; end;
    if v_msg is null or v_msg not like 'Le suivi des appels%' then
      raise exception 'nb_tentatives écrit à la main : attendu un refus, obtenu « % »', coalesce(v_msg, 'accepté');
    end if;

    -- 8. colonnes = historique
    if exists (select 1 from public.commandes c cross join lateral public.suivi_statuts(c.id) s
                where c.id in (v_c1, v_c2)
                  and (c.nb_tentatives, c.derniere_tentative_statut, c.derniere_tentative_le, c.derniere_action_le)
                      is distinct from (s.nb_tentatives, s.derniere_tentative_statut, s.derniere_tentative_le, s.derniere_action_le)) then
      raise exception 'suivi différent de l''historique recompté';
    end if;

    perform count(*) from public.v_historique_statuts where lot_id is not null;
    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'commandes_statut_lot.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;

  if exists (select 1 from public.commandes where lead_id like v_lead || '%')
     or exists (select 1 from public.historique_statuts where commande_lead_id like v_lead || '%') then
    raise exception 'Répétition : des écritures sont restées (elles auraient dû être annulées).';
  end if;
  raise notice 'commandes_statut_lot.sql : répétition réussie (naissance, lot Non joint sans tentative, vrai appel compté, Pending avec motif, Rappel borné, livreur nommé, garde, suivi = historique), tout annulé.';
end $$;

-- Ce qui est en place (à lire) : les commandes avec au moins une tentative.
select lead_id, statut_confirmation, nb_tentatives, derniere_tentative_statut, derniere_tentative_le, derniere_action_le
  from public.commandes where nb_tentatives > 0 order by derniere_tentative_le desc;
