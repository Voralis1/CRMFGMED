-- =============================================================================
-- Historique des statuts d'appel — 28/10/2026
-- =============================================================================
--
-- UNE LIGNE PAR CHANGEMENT DE `commandes.statut_confirmation`, par TOUS les
-- chemins, jamais modifiée, JAMAIS supprimée — pas même avec sa commande.
-- Une trace qui disparaît avec ce qu'elle enregistre ne vaut rien (28/10).
-- Même règle que produits_historique_nom.sql : la commande supprimée, le lien
-- devient NULL (seule modification permise) et la ligne se lit encore par ce
-- qu'elle a gardé de la commande (n° de lead, tracking, client, produit,
-- vendeur, entreprise), écrit au moment du changement.
--
-- Pourquoi pas `appels` : il n'est écrit que par confirmer-appel (et par
-- l'import, qui y met une fausse ligne « en_attente » par lead) ; les agents
-- peuvent le MODIFIER et les responsables le SUPPRIMER (RLS) ; l'appel est
-- écrit AVANT la commande, donc un échec laisse un appel qui n'a rien changé ;
-- et l'agent peut le lire. `appels` reste ce qu'il est (écran d'appel,
-- Performances) ; l'historique, c'est cette table.
--
-- Seulement les statuts D'APPEL (décision du 28/10) : le statut de livraison
-- se lit dans Livraisons. Le livreur n'apparaît donc jamais ici.
--
-- CE QUE FAIT CE FICHIER (il ne modifie AUCUNE commande) :
--   §1  arrêt si les prérequis manquent ;
--   §2  la table `historique_statuts` — aucun droit pour les comptes de l'app ;
--   §3  la garde : pas d'écriture à la main, pas de suppression, aucune
--       modification sauf le lien vers une commande supprimée qui devient
--       NULL (ON DELETE SET NULL) ;
--   §4  le trigger sur commandes qui écrit la ligne — navigateur, clé service,
--       éditeur SQL, triggers : aucun chemin n'y échappe ;
--   §5  enregistrer_appel(...) : la porte de confirmer-appel — l'appel, la
--       commande et l'historique dans UNE transaction, avec qui et le
--       commentaire. Clé service seulement ;
--   §6  la vue `v_historique_statuts`, le SEUL chemin de lecture de l'app ;
--   §7  la reprise des appels réels déjà enregistrés (marqués « migration ») ;
--   §8  vérification (droits, triggers, clé SET NULL) ;
--   §9  répétition : de vraies écritures sur commandes, annulées à la fin.
--       Un trigger fautif arrête le fichier ICI — l'éditeur SQL n'installe
--       alors rien du tout.
--
-- ORDRE : ce fichier D'ABORD, puis `npx supabase functions deploy
-- confirmer-appel`. Dans l'autre sens, chaque enregistrement d'appel échoue
-- (la fonction SQL n'existe pas encore). Entre les deux, l'ancien
-- confirmer-appel marche toujours ; ses changements sont historisés sans nom
-- ni commentaire (« système ») : déployer juste après.
--
-- Exécutable en entier, et deux fois.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Prérequis
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_aa_statut_pending'
                    and tgrelid = 'public.commandes'::regclass) then
    raise exception 'Lancez d''abord statut_pending.sql : l''historique suppose qu''un lead neuf est « Pending », jamais NULL.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'appels'
                    and column_name = 'statut_precedent') then
    raise exception 'appels.statut_precedent manque (appels_historique.sql) : rien n''a été installé.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. La table
-- -----------------------------------------------------------------------------
-- Pas de clé étrangère vers auth.users, appels ou tenants, exprès : un
-- « on delete set null » est une MODIFICATION de la ligne, que la garde (§3)
-- refuse — supprimer un compte ou un appel échouerait. Celui qui a agi est
-- gardé par son id ET son nom au moment des faits (`fait_par_nom`), comme le
-- nom d'un produit dans mouvements_stock : supprimer le compte ne réécrit
-- pas l'histoire.
-- La seule clé étrangère est la commande, en SET NULL : la commande
-- supprimée, la ligne reste. C'est la seule modification que la garde (§3)
-- laisse passer.
--
-- La ligne porte elle-même ce qui permet de la lire sans la commande :
--   · tenant_id : sans lui, une ligne dont la commande est supprimée ne
--     serait plus rattachée à aucune entreprise — invisible à tous, donc
--     supprimée sans le dire ;
--   · vendeur_id : le vendeur lit encore l'historique de SA commande
--     supprimée (la vue lit le vendeur vivant tant que la commande existe) ;
--   · commande_lead_id, commande_tracking, commande_client, commande_produit :
--     de quelle commande il s'agissait. Figés au moment du changement : une
--     commande renommée plus tard garde son ancien nom sur ses anciennes
--     lignes, comme le nom d'un produit dans mouvements_stock.
create table if not exists public.historique_statuts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  commande_id      uuid references public.commandes(id) on delete set null,
  vendeur_id       uuid,
  commande_lead_id  text,
  commande_tracking text,
  commande_client   text,
  commande_produit  text,
  statut_precedent text,
  statut           text not null,
  -- Le compte (auth.users.id) qui a fait le changement ; NULL = personne
  -- d'identifiable (import par l'API, éditeur SQL, appel ancien sans agent).
  fait_par         uuid,
  fait_par_nom     text,
  -- Le commentaire de l'agent (« Ne répond pas »…), tel qu'écrit.
  note             text,
  -- Le temps de traitement mesuré par le panneau d'appel (« Traiter » →
  -- « Enregistrer »), recopié de la SEULE mesure : celle que confirmer-appel
  -- borne et écrit dans appels.duree_secondes. Jamais calculé ici. NULL =
  -- pas mesuré (changement depuis Commandes, import…), jamais 0.
  duree_secondes   integer,
  -- Par où le changement est passé :
  --   confirmer-appel : le panneau d'appel ou le tiroir de Commandes ;
  --   navigateur      : un update direct depuis l'app (compte connecté) ;
  --   systeme         : clé service hors confirmer-appel (import API),
  --                     éditeur SQL ;
  --   migration       : RECOPIÉ de `appels` par §7 le jour de l'installation.
  --                     Pas une ligne écrite au moment du changement.
  via              text not null
                   check (via in ('confirmer-appel', 'navigateur', 'systeme', 'migration')),
  -- L'appel correspondant (lien informatif, sans clé étrangère).
  appel_id         uuid,
  cree_le          timestamptz not null default now()
);

create index if not exists idx_historique_statuts_commande
  on public.historique_statuts (commande_id, cree_le);
create index if not exists idx_historique_statuts_tenant
  on public.historique_statuts (tenant_id, cree_le);
-- Un appel n'est recopié qu'une fois (§7 rejouable).
create unique index if not exists idx_historique_statuts_appel
  on public.historique_statuts (appel_id) where appel_id is not null;

-- Aucun compte de l'app ne lit ni n'écrit la table : la vue (§6) est le seul
-- chemin de lecture, le trigger (§4) le seul chemin d'écriture. RLS activée
-- sans aucune politique : même un droit accordé par erreur ne laisserait rien
-- passer.
alter table public.historique_statuts enable row level security;
revoke all on public.historique_statuts from public, anon, authenticated, service_role;
grant select on public.historique_statuts to service_role;


-- -----------------------------------------------------------------------------
-- 3. La garde
-- -----------------------------------------------------------------------------
-- INSERT : seulement depuis le trigger de commandes (profondeur 2 : le
--   trigger de commandes, puis cette garde), ou par la reprise du §7 qui le
--   dit (réglage local `crm.historique_migration`). Une ligne écrite à la
--   main serait un faux historique.
-- UPDATE : une seule permise — commande_id → NULL quand la commande n'existe
--   plus, RIEN d'autre ne bouge. C'est l'ON DELETE SET NULL de la suppression
--   d'une commande (le nettoyage des commandes de test,
--   vider_donnees_operationnelles, un manager). Tout le reste : refusé, pour
--   tout le monde (éditeur SQL compris).
-- DELETE : jamais, pour personne. Ni à la main, ni avec la commande.
-- TRUNCATE : jamais.
-- SECURITY DEFINER : la garde doit voir si la commande existe encore quelle
-- que soit la RLS de celui qui supprime.
create or replace function public.historique_statuts_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if pg_trigger_depth() < 2
       and coalesce(current_setting('crm.historique_migration', true), '') <> 'oui' then
      raise exception 'L''historique des statuts ne s''écrit pas à la main : il s''écrit tout seul quand le statut d''une commande change.';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.commande_id is not null
       and new.commande_id is null
       and (to_jsonb(new) - 'commande_id') = (to_jsonb(old) - 'commande_id')
       and not exists (select 1 from public.commandes where id = old.commande_id) then
      return new; -- la commande vient d'être supprimée : la ligne reste
    end if;
    raise exception 'L''historique des statuts ne se modifie pas.';
  elsif tg_op = 'DELETE' then
    raise exception 'L''historique des statuts ne se supprime pas, même quand sa commande est supprimée.';
  else -- TRUNCATE
    raise exception 'L''historique des statuts ne se vide pas.';
  end if;
end;
$$;

revoke all on function public.historique_statuts_garde() from public, anon, authenticated;

create or replace trigger trg_historique_statuts_garde
  before insert or update or delete on public.historique_statuts
  for each row execute function public.historique_statuts_garde();

create or replace trigger trg_historique_statuts_garde_vider
  before truncate on public.historique_statuts
  for each statement execute function public.historique_statuts_garde();


-- -----------------------------------------------------------------------------
-- 4. Le trigger sur commandes
-- -----------------------------------------------------------------------------
-- AFTER : il voit le statut FINAL (après « NULL → Pending » de
-- trg_aa_statut_pending et tous les BEFORE), et seulement si l'écriture a
-- réussi. Même transaction que le changement : pas de changement sans ligne,
-- pas de ligne sans changement.
--
-- Qui a agi :
--   · un compte connecté (navigateur) → auth.uid(). Il ne peut pas se faire
--     passer pour un autre : on prend toujours auth.uid() quand il existe ;
--   · confirmer-appel (clé service, auth.uid() NULL) → ce que
--     enregistrer_appel (§5) a posé pour CETTE transaction : le compte de
--     l'appelant, le commentaire, la durée, l'appel ;
--   · sinon (import API, éditeur SQL) → personne, via « systeme ».
--
-- INSERT compris : la naissance du lead (→ « Pending ») est la première
-- ligne, le point de départ des autres.
-- GARDE (02/11) : ecrire_historique_statut est définie aujourd'hui par commandes_statut_lot.sql.
-- Ce fichier ne la réécrit que si elle manque, n'a pas de marque, porte la
-- sienne ou celle d'un fichier plus ancien. Marquée par un fichier plus
-- récent → gardée telle quelle, avec un avis (rien n'échoue).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.ecrire_historique_statut()'), 'pg_proc');
begin
  if v_marque in ('fichier: commandes_statut_lot.sql') then
    raise notice 'historique_statuts.sql : ecrire_historique_statut gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
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
begin
  if tg_op = 'UPDATE'
     and new.statut_confirmation is not distinct from old.statut_confirmation then
    return null; -- adresse corrigée, statut inchangé : pas un changement
  end if;

  if v_uid is not null then
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

  -- Le nom au moment des faits : la fiche agent dans cette entreprise, sinon
  -- le nom du compte, sinon son e-mail.
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
     fait_par, fait_par_nom, note, duree_secondes, via, appel_id)
  values
    (new.tenant_id, new.id, new.vendeur_id,
     new.lead_id, new.tracking_number, new.client_nom, new.produit,
     case when tg_op = 'UPDATE' then old.statut_confirmation end,
     new.statut_confirmation,
     v_acteur, v_nom, v_note, v_duree, v_via, v_appel);

  return null;
end;
$$
$def$;
  comment on function public.ecrire_historique_statut() is 'fichier: historique_statuts.sql';
end $garde$;

revoke all on function public.ecrire_historique_statut() from public, anon, authenticated;

create or replace trigger trg_historique_statut
  after insert or update of statut_confirmation on public.commandes
  for each row execute function public.ecrire_historique_statut();


-- -----------------------------------------------------------------------------
-- 5. enregistrer_appel : la porte de confirmer-appel
-- -----------------------------------------------------------------------------
-- Avant : confirmer-appel écrivait l'appel, PUIS mettait la commande à jour
-- (deux requêtes). Un refus de la commande laissait un appel qui n'avait rien
-- changé, et le trigger du §4 n'aurait pas su qui avait agi (clé service).
-- Maintenant : une seule transaction — l'appel, qui/commentaire/durée posés
-- pour le trigger, la commande. Un refus annule tout.
--
-- Toutes les vérifications (droits, adresse, rappel, pays) restent dans
-- confirmer-appel ; cette fonction n'écrit que ce qu'on lui donne. D'où :
-- clé service SEULEMENT, jamais un compte de l'app.
--
-- p_maj : les champs de la commande envoyés par l'écran (ceux qui manquent
-- ne sont pas touchés), déjà nettoyés par confirmer-appel. Liste fermée.
create or replace function public.enregistrer_appel(
  p_commande_id      uuid,
  p_tenant_id        uuid,
  p_fait_par         uuid,
  p_agent_id         uuid,
  p_statut           text,
  p_statut_precedent text,
  p_notes            text,
  p_duree_secondes   integer,
  p_date_rappel      timestamptz,
  p_maj              jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appel public.appels;
  m jsonb := coalesce(p_maj, '{}'::jsonb);
begin
  insert into public.appels
    (commande_id, agent_id, statut, statut_precedent, tenant_id, notes, duree_secondes, date_rappel)
  values
    (p_commande_id, p_agent_id, p_statut, p_statut_precedent, p_tenant_id,
     p_notes, p_duree_secondes, p_date_rappel)
  returning * into v_appel;

  -- Pour le trigger du §4, le temps de CETTE transaction seulement.
  perform set_config('crm.historique_via',    'confirmer-appel', true);
  perform set_config('crm.historique_acteur', coalesce(p_fait_par::text, ''), true);
  perform set_config('crm.historique_note',   coalesce(p_notes, ''), true);
  perform set_config('crm.historique_duree',  coalesce(p_duree_secondes::text, ''), true);
  perform set_config('crm.historique_appel',  v_appel.id::text, true);

  update public.commandes c set
    statut_confirmation = p_statut,
    date_rappel         = p_date_rappel,
    updated_at          = now(),
    source           = case when m ? 'source'           then m->>'source'                 else c.source end,
    client_nom       = case when m ? 'client_nom'       then m->>'client_nom'             else c.client_nom end,
    client_telephone = case when m ? 'client_telephone' then m->>'client_telephone'       else c.client_telephone end,
    ville_zone       = case when m ? 'ville_zone'       then m->>'ville_zone'             else c.ville_zone end,
    adresse          = case when m ? 'adresse'          then m->>'adresse'                else c.adresse end,
    zone_id          = case when m ? 'zone_id'          then (m->>'zone_id')::uuid        else c.zone_id end,
    pays_id          = case when m ? 'pays_id'          then (m->>'pays_id')::uuid        else c.pays_id end,
    produit          = case when m ? 'produit'          then m->>'produit'                else c.produit end,
    quantite         = case when m ? 'quantite'         then (m->>'quantite')::integer    else c.quantite end,
    prix             = case when m ? 'prix'             then (m->>'prix')::numeric        else c.prix end,
    agent_id         = case when m ? 'agent_id'         then (m->>'agent_id')::uuid       else c.agent_id end
  where c.id = p_commande_id and c.tenant_id = p_tenant_id;

  if not found then
    raise exception 'Commande introuvable';
  end if;

  -- Rien ne doit hériter de ces réglages dans la suite de la transaction.
  perform set_config('crm.historique_via',    '', true);
  perform set_config('crm.historique_acteur', '', true);
  perform set_config('crm.historique_note',   '', true);
  perform set_config('crm.historique_duree',  '', true);
  perform set_config('crm.historique_appel',  '', true);

  return to_jsonb(v_appel);
end;
$$;

revoke all on function public.enregistrer_appel(uuid, uuid, uuid, uuid, text, text, text, integer, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.enregistrer_appel(uuid, uuid, uuid, uuid, text, text, text, integer, timestamptz, jsonb)
  to service_role;


-- -----------------------------------------------------------------------------
-- 6. La vue : le seul chemin de lecture
-- -----------------------------------------------------------------------------
-- Les droits de colonne valent par rôle Postgres, et tous les comptes de
-- l'app sont `authenticated` : impossible de donner « fait_par » au manager
-- et pas au vendeur par un GRANT. Donc une vue qui tourne comme son
-- propriétaire (security_invoker OFF, comme v_pays_livrables) et décide
-- elle-même :
--   · super_admin                 : tout (l'écran filtre par entreprise) ;
--   · admin, manager, ceo         : toute leur entreprise, avec qui ;
--   · seller                      : ses commandes seulement (le vendeur
--                                   vivant de la commande ; celui gardé sur
--                                   la ligne quand elle est supprimée), SANS qui —
--                                   colonnes vidées ici, pas cachées par
--                                   l'écran ; le commentaire reste
--                                   (décision du 28/10) ;
--   · agent, livreur, autre       : aucune ligne.
-- security_barrier : un filtre ajouté par l'appelant ne passe jamais avant
-- celui de la vue.
-- Une commande supprimée : commande_id NULL, commande_supprimee vrai, et la
-- ligne se lit par ce qu'elle a gardé (commande_lead_id…). `appel_id` et
-- `vendeur_id` ne sont pas exposés.
-- GARDE (02/11) : la vue v_historique_statuts est définie aujourd'hui par
-- commandes_statut_lot.sql (avec lot_id). Postgres refuse de retirer une colonne
-- d'une vue : sans cette garde, relancer ce fichier échouait en entier. Marquée
-- par commandes_statut_lot.sql → gardée telle quelle, avec un avis.
do $garde$
declare
  v_marque text := obj_description(to_regclass('public.v_historique_statuts'), 'pg_class');
begin
  if v_marque in ('fichier: commandes_statut_lot.sql') then
    raise notice 'historique_statuts.sql : v_historique_statuts gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
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
       h.cree_le
  from public.historique_statuts h
 where public.is_super_admin()
    or (h.tenant_id = public.get_my_tenant_id()
        and (public.est_responsable()
             or (public.mon_role() = 'seller'
                 and coalesce((select c.vendeur_id from public.commandes c
                                where c.id = h.commande_id),
                              h.vendeur_id) = auth.uid())))
$def$;
  comment on view public.v_historique_statuts is 'fichier: historique_statuts.sql';
end $garde$;

-- Lecture seule : une vue simple est modifiable par défaut, et celle-ci
-- tourne comme son propriétaire.
revoke all on public.v_historique_statuts from public, anon, authenticated;
grant select on public.v_historique_statuts to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Reprise des appels déjà enregistrés
-- -----------------------------------------------------------------------------
-- Les appels RÉELS de `appels` (pas les fausses lignes « en_attente » que
-- l'import écrit pour chaque lead), dont le statut a changé. Marqués
-- via = 'migration' : recopiés le jour de l'installation, pas écrits au
-- moment du changement. Leur durée est celle du panneau, recopiée telle
-- quelle (même mesure) ; qui = la fiche agent de l'appel, sinon personne
-- (les appels d'un responsable ne portent pas d'agent). Ce qui identifie la
-- commande est lu sur la commande d'AUJOURD'HUI (l'appel ne l'a pas gardé).
-- Les appels dont la commande n'existe plus ne sont pas repris : il ne reste
-- rien pour dire de quelle commande il s'agissait.
--
-- Rejouable : un appel déjà recopié ne l'est pas deux fois, et seuls les
-- appels ANTÉRIEURS à la première ligne vivante sont repris — un appel
-- enregistré après l'installation a déjà sa ligne, écrite par le trigger.
do $$
declare
  v_n integer;
  v_limite timestamptz;
begin
  select min(cree_le) into v_limite
    from public.historique_statuts where via <> 'migration';

  perform set_config('crm.historique_migration', 'oui', true);

  insert into public.historique_statuts
    (tenant_id, commande_id, vendeur_id,
     commande_lead_id, commande_tracking, commande_client, commande_produit,
     statut_precedent, statut,
     fait_par, fait_par_nom, note, duree_secondes, via, appel_id, cree_le)
  select a.tenant_id, a.commande_id, c.vendeur_id,
         c.lead_id, c.tracking_number, c.client_nom, c.produit,
         a.statut_precedent, a.statut,
         ag.user_id, nullif(btrim(ag.nom), ''), a.notes, a.duree_secondes,
         'migration', a.id, coalesce(a.created_at, now())
    from public.appels a
    join public.commandes c on c.id = a.commande_id
    left join public.agents ag on ag.id = a.agent_id
   where a.statut is not null
     and a.statut <> 'en_attente'
     and a.statut is distinct from a.statut_precedent
     and (v_limite is null or a.created_at < v_limite)
     and not exists (select 1 from public.historique_statuts h where h.appel_id = a.id);
  get diagnostics v_n = row_count;

  perform set_config('crm.historique_migration', '', true);
  raise notice 'historique_statuts.sql : % appel(s) recopié(s) (via = migration).', v_n;
end $$;


-- -----------------------------------------------------------------------------
-- 8. Vérification
-- -----------------------------------------------------------------------------
do $$
declare
  r text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_historique_statut'
                    and tgrelid = 'public.commandes'::regclass and tgenabled <> 'D') then
    raise exception 'trg_historique_statut absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_historique_statuts_garde'
                    and tgrelid = 'public.historique_statuts'::regclass and tgenabled <> 'D') then
    raise exception 'trg_historique_statuts_garde absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.historique_statuts'::regclass
                    and contype = 'f' and confdeltype = 'n') then
    raise exception 'historique_statuts.commande_id doit être ON DELETE SET NULL (jamais CASCADE).';
  end if;
  if exists (select 1 from pg_constraint
              where conrelid = 'public.historique_statuts'::regclass
                and contype = 'f' and confdeltype = 'c') then
    raise exception 'historique_statuts a une clé en CASCADE : supprimer une commande effacerait son historique.';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.historique_statuts', 'select, insert, update, delete') then
      raise exception '% a encore un droit sur historique_statuts.', r;
    end if;
    if has_function_privilege(r, 'public.enregistrer_appel(uuid, uuid, uuid, uuid, text, text, text, integer, timestamptz, jsonb)', 'execute') then
      raise exception '% peut appeler enregistrer_appel.', r;
    end if;
    if has_table_privilege(r, 'public.v_historique_statuts', 'insert, update, delete') then
      raise exception '% peut écrire dans v_historique_statuts.', r;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.v_historique_statuts', 'select') then
    raise exception 'anon peut lire v_historique_statuts.';
  end if;
  if not has_table_privilege('authenticated', 'public.v_historique_statuts', 'select') then
    raise exception 'authenticated ne peut pas lire v_historique_statuts.';
  end if;
  if not has_function_privilege('service_role', 'public.enregistrer_appel(uuid, uuid, uuid, uuid, text, text, text, integer, timestamptz, jsonb)', 'execute') then
    raise exception 'service_role ne peut pas appeler enregistrer_appel : confirmer-appel échouerait.';
  end if;
  if exists (select 1 from pg_class where oid = 'public.v_historique_statuts'::regclass
                and coalesce(reloptions, '{}') @> array['security_invoker=on']) then
    raise exception 'v_historique_statuts doit tourner comme son propriétaire (security_invoker off).';
  end if;
  raise notice 'historique_statuts.sql : en place. Aucune commande modifiée.';
end $$;

-- -----------------------------------------------------------------------------
-- 9. Répétition générale : de VRAIES écritures, puis tout est annulé
-- -----------------------------------------------------------------------------
-- Postgres accepte une fonction de trigger fautive à sa création (une colonne
-- mal écrite ne se voit qu'à l'exécution) : §8 passerait, et la première
-- écriture sur commandes échouerait. Ici, on écrit pour de bon, dans un bloc
-- qui s'annule toujours à la fin :
--   une commande créée → mise « Unreached » → adresse seule corrigée →
--   enregistrer_appel (comme confirmer-appel) → une ligne supprimée à la
--   main (doit être refusé) → la commande supprimée (ses lignes doivent
--   rester).
-- Tout réussi : le bloc lève « REPETITION_OK », ce qui ANNULE tout ce qu'il a
-- écrit, et on continue. Quoi que ce soit d'autre : le fichier s'arrête avec
-- la raison. L'éditeur SQL exécutant le fichier en UNE transaction, rien
-- n'est alors installé du tout.
--
-- Où : l'entreprise de test (17144700…, « FGMED (Données Existantes) »),
-- jamais Fgmed Angola ; à défaut (base de test), la première entreprise qui
-- a un pays. Rien ne reste : ni commande, ni appel, ni ligne d'historique,
-- ni livraison. Seule trace possible : le compteur des numéros de tracking
-- (FG…) avance d'un cran — une séquence ne revient jamais en arrière.
do $$
declare
  v_t   uuid;
  v_p   uuid;
  v_c   uuid;
  v_lead text := 'REPETITION-' || replace(gen_random_uuid()::text, '-', '');
  v_n   integer;
  v_h   public.historique_statuts;
  v_msg text;
begin
  select id into v_t from public.tenants where id = '17144700-2b95-43fa-9849-9e7a8f35104e';
  if v_t is null then
    select p.tenant_id into v_t from public.pays p order by p.tenant_id limit 1;
  end if;
  select p.id into v_p from public.pays p where p.tenant_id = v_t order by p.nom limit 1;
  if v_t is null or v_p is null then
    raise exception 'Répétition impossible : aucune entreprise avec un pays.';
  end if;

  begin
    -- 1. une commande neuve → une ligne « → Pending »
    insert into public.commandes (lead_id, tenant_id, pays_id, client_nom, client_telephone, produit, quantite, prix)
    values (v_lead, v_t, v_p, 'Répétition', '+000', 'Répétition', 1, 0)
    returning id into v_c;
    select * into v_h from public.historique_statuts where commande_id = v_c;
    if v_h.id is null or v_h.statut <> 'Pending' or v_h.commande_lead_id <> v_lead or v_h.tenant_id <> v_t then
      raise exception 'insertion : pas de ligne « → Pending » correcte';
    end if;

    -- 2. changement de statut → une deuxième ligne
    update public.commandes set statut_confirmation = 'Unreached' where id = v_c;
    select count(*) into v_n from public.historique_statuts where commande_id = v_c;
    if v_n <> 2 then raise exception 'changement de statut : % ligne(s) au lieu de 2', v_n; end if;

    -- 3. adresse seule → aucune ligne de plus
    update public.commandes set adresse = 'Répétition', statut_confirmation = 'Unreached' where id = v_c;
    select count(*) into v_n from public.historique_statuts where commande_id = v_c;
    if v_n <> 2 then raise exception 'adresse seule : % ligne(s) au lieu de 2', v_n; end if;

    -- 4. le chemin de confirmer-appel
    perform public.enregistrer_appel(v_c, v_t, null, null, 'Cancelled', 'Unreached',
                                     'Répétition', 7, null, '{"adresse": "Répétition 2"}'::jsonb);
    select * into v_h from public.historique_statuts where commande_id = v_c and statut = 'Cancelled';
    if v_h.id is null or v_h.via <> 'confirmer-appel' or v_h.note <> 'Répétition'
       or v_h.duree_secondes <> 7 or v_h.appel_id is null then
      raise exception 'enregistrer_appel : ligne absente ou incomplète';
    end if;
    if (select adresse from public.commandes where id = v_c) <> 'Répétition 2' then
      raise exception 'enregistrer_appel : la commande n''a pas été mise à jour';
    end if;
    if coalesce(current_setting('crm.historique_via', true), '') <> '' then
      raise exception 'enregistrer_appel : ses réglages débordent sur la suite de la transaction';
    end if;

    -- 5. supprimer une ligne à la main → doit être refusé
    begin
      delete from public.historique_statuts where commande_id = v_c;
      raise exception 'GARDE_ABSENTE';
    exception when others then
      if sqlerrm = 'GARDE_ABSENTE' then
        raise exception 'garde : une ligne d''historique a pu être supprimée';
      end if;
    end;

    -- 6. supprimer la commande → ses trois lignes restent, sans lien
    delete from public.appels where commande_id = v_c;
    delete from public.livraisons where commande_id = v_c;
    delete from public.commandes where id = v_c;
    select count(*) into v_n from public.historique_statuts
     where commande_lead_id = v_lead and commande_id is null and tenant_id = v_t;
    if v_n <> 3 then
      raise exception 'suppression de la commande : % ligne(s) gardée(s) au lieu de 3', v_n;
    end if;

    -- 7. la vue s'exécute
    perform count(*) from public.v_historique_statuts;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'historique_statuts.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;

  -- Le bloc est annulé : rien ne doit rester.
  if exists (select 1 from public.historique_statuts where commande_lead_id = v_lead)
     or exists (select 1 from public.commandes where lead_id = v_lead) then
    raise exception 'Répétition : des écritures sont restées (elles auraient dû être annulées).';
  end if;
  raise notice 'historique_statuts.sql : répétition réussie (écrire, changer, enregistrer_appel, garde, suppression), tout annulé.';
end $$;

-- Ce qui est en place (à lire) :
select via, count(*) as lignes from public.historique_statuts group by via order by via;
