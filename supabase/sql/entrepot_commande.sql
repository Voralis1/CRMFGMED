-- =====================================================================
-- L'entrepôt d'une commande — 21/10/2026, règle remplacée le 22/10/2026
-- =====================================================================
--
-- LA RÈGLE (22/10) :
--
--   entrepot_id = l'entrepôt du pays de la commande. Toujours, par tous
--   les chemins : import CSV (responsable ou vendeur), API, saisie manuelle.
--
-- Il y a exactement un entrepôt par pays et par entreprise
-- (idx_entrepots_un_par_pays, règle du 13/10). Vérifié en production le
-- 22/10 : index unique (tenant_id, pays_id) en place, aucun doublon, aucun
-- entrepôt sans pays, aucun entrepôt rattaché au pays d'une autre
-- entreprise. Un entrepôt sans pays (pays_id null, que l'index laisse
-- passer) n'est jamais choisi : « pays_id = pays de la commande » n'est
-- jamais vrai pour null.
--
-- Ce que ça remplace (21/10) : « le produit donne les entrepôts qui le
-- stockent, le pays du client départage ». Avec un entrepôt par pays, il
-- n'y a jamais eu d'égalité à départager : le pays décidait toujours, et le
-- produit ne pouvait que mettre un veto (pas rangé ici → pas d'entrepôt).
-- Le veto est retiré : le produit ne choisit pas l'entrepôt et ne le
-- refuse pas.
--
-- Le stock d'un autre pays devient IMPOSSIBLE par construction : on ne
-- regarde jamais hors du pays du client, donc on ne peut pas sortir du
-- stock du Congo pour un client en Angola. C'est pour ça que le contrôle du
-- produit n'a plus besoin d'être un veto.
--
-- Une commande reste sans entrepôt dans un seul cas : son pays n'a pas
-- d'entrepôt. Rien d'autre.
--
-- LE PRODUIT NE CHOISIT PAS L'ENTREPÔT. Le stock non plus : il n'est pas
-- écrit sur la commande à sa création (une note de stock serait fausse dès
-- le premier réassort). L'écran Commandes le lit EN DIRECT par la porte
-- produits_en_stock (§8) et affiche la rupture. À la livraison :
--   · produit introuvable au catalogue : aucun mouvement (on ne sait pas
--     quoi sortir), une note ;
--   · produit au catalogue sans ligne de stock dans cet entrepôt : le
--     mouvement est fait, le stock passe en négatif, une note. Ce négatif
--     dit vrai : de la marchandise a été vendue sans avoir été déclarée dans
--     cet entrepôt. Le cacher n'aiderait personne.
--
-- LA GARDE : un entrepôt écrit sur une commande (navigateur, API, éditeur
-- SQL) doit être celui du pays de la commande, dans son entreprise. Sinon,
-- refus, avec le nom du bon. Vérifié le 22/10 : aucune commande existante
-- ne la viole.
--
-- DEUX FICHIERS :
--   1. celui-ci — la règle, le trigger, la garde, et la DÉFINITION du
--      rattrapage. Il ne modifie AUCUNE ligne existante : les commandes
--      gardent leur entrepôt (ou leur absence d'entrepôt) jusqu'au fichier 2.
--   2. entrepot_commande_2_rattrapage.sql — l'APPEL du rattrapage, à lancer
--      quand on le décide.
-- Entre les deux, rien ne casse : une commande sans entrepôt prend celui de
-- son pays à la livraison (fn_ajuster_stock_livraison) ou dès que son pays
-- change ; la garde ne se déclenche que si quelqu'un écrit entrepot_id.
--
-- Ce fichier peut être exécuté en entier, et deux fois : create or replace,
-- drop … if exists. Il ne touche pas l'API : import-commande et pays.ts
-- sont inchangés (le verdict produit de l'import CSV est dans la page).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Colonnes
-- ---------------------------------------------------------------------
-- stock_ajuste / stock_note : déjà en production (livraison_stock.sql).
alter table public.commandes add column if not exists stock_ajuste timestamptz;
alter table public.commandes add column if not exists stock_note   text;

-- entrepot_choisi (écrit le matin du 22/10, jamais exécuté) : avec un seul
-- entrepôt possible par commande, un entrepôt « choisi » ne peut plus
-- différer d'un entrepôt « déduit ». Plus aucun cas : retirée, au cas où.
alter table public.commandes drop column if exists entrepot_choisi;


-- ---------------------------------------------------------------------
-- 1. L'entrepôt d'un pays
-- ---------------------------------------------------------------------
-- Au plus une ligne (idx_entrepots_un_par_pays). Pas SECURITY DEFINER :
-- appelée seulement depuis les fonctions ci-dessous, qui le sont.
create or replace function public.entrepot_du_pays(p_tenant uuid, p_pays uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  select e.id
    from public.entrepots e
   where e.tenant_id = p_tenant
     and e.pays_id   = p_pays
   limit 1;
$$;

revoke all on function public.entrepot_du_pays(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Le produit d'une commande — pour la note et le mouvement, jamais
--    pour l'entrepôt
-- ---------------------------------------------------------------------
-- Par CODE d'abord, puis par NOM — les deux sans accents, sans casse, sans
-- espaces autour ni en trop (comme sansAccents() dans _shared/pays.ts et
-- produitDuCatalogue() dans lib/verdictImport.mjs). L'index unique
-- (idx_produits_code_unique) compare lower(btrim(code)), avec les accents :
-- « Café » et « Cafe » peuvent coexister et se confondre ici. Deux réponses,
-- par code ou par nom : aucune, choisir au hasard décompterait peut-être le
-- mauvais.
-- La normalisation d'un texte — UNE définition (29/10 : déplacée ici depuis
-- zone_commande.sql, pour que produit_de_commande l'appelle au lieu de
-- recopier l'expression). Accents (unaccent_simple), casse, espaces en bord
-- et répétés. Vide ou NULL → NULL : deux textes vides ne sont jamais
-- « égaux ». Utilisée aussi par zone_de_commande et livreur_pour_commande.
create or replace function public.texte_normalise(p_texte text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(lower(regexp_replace(btrim(public.unaccent_simple(p_texte)), '\s+', ' ', 'g')), '');
$$;

create or replace function public.produit_de_commande(p_tenant uuid, p_produit text)
returns table (produit_id uuid, cas text, raison text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_texte   text := btrim(coalesce(p_produit, ''));
  v_nom     text;
  v_produit uuid;
  v_combien integer;
begin
  if v_texte = '' then
    return query select null::uuid, 'sans_produit'::text,
      'La commande ne porte aucun nom de produit.'::text;
    return;
  end if;

  -- texte_normalise : LA normalisation (29/10, plus d'expression recopiée ici).
  -- v_texte n'est pas vide : son nom normalisé non plus.
  v_nom := public.texte_normalise(v_texte);

  select count(*), min(p.id::text)::uuid into v_combien, v_produit
    from public.produits p
   where p.tenant_id = p_tenant
     and p.code is not null and btrim(p.code) <> ''
     and public.texte_normalise(p.code) = v_nom;
  if v_combien = 1 then
    return query select v_produit, 'trouve'::text, null::text;
    return;
  elsif v_combien > 1 then
    return query select null::uuid, 'produit_ambigu'::text,
      (v_combien || ' produits portent le code « ' || v_texte
        || ' » (aux accents près) : impossible de savoir lequel décompter.')::text;
    return;
  end if;

  select count(*), min(p.id::text)::uuid into v_combien, v_produit
    from public.produits p
   where p.tenant_id = p_tenant
     and public.texte_normalise(p.product) = v_nom;

  if v_combien = 1 then
    return query select v_produit, 'trouve'::text, null::text;
  elsif v_combien = 0 then
    return query select null::uuid, 'produit_inconnu'::text,
      ('Produit « ' || v_texte || ' » introuvable au catalogue.')::text;
  else
    return query select null::uuid, 'produit_ambigu'::text,
      (v_combien || ' produits portent le nom « ' || v_texte
        || ' » : impossible de savoir lequel décompter.')::text;
  end if;
end;
$$;

revoke all on function public.produit_de_commande(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. La règle : l'entrepôt du pays, et la note du produit
-- ---------------------------------------------------------------------
-- Même nom et même forme qu'au 21/10 (create or replace possible), sens
-- nouveau : entrepot_id ne dépend QUE du pays.
-- cas :
--   resolu              l'entrepôt du pays a une ligne de stock pour ce produit
--   non_stocke          produit au catalogue, pas de ligne dans cet entrepôt
--   produit_inconnu     ni le code ni le nom ne répondent
--   produit_ambigu      deux produits portent ce nom
--   sans_produit        la commande ne porte pas de produit
--   pays_sans_entrepot  le pays de la commande n'a pas d'entrepôt
--   sans_pays           la commande n'a pas de pays
-- raison : la phrase pour la livraison. note : ce qu'on écrit dès la
-- création — seulement ce qui ne change pas tout seul : pas d'entrepôt dans
-- le pays, produit ambigu, pas de produit. Vide pour un produit inconnu
-- (c'est au catalogue de le corriger, 82 commandes le sont le 22/10 : les
-- marquer toutes en rouge noierait les vraies alertes) et vide pour
-- non_stocke (le stock bouge : l'écran le lit en direct).
create or replace function public.resoudre_entrepot_commande(
  p_tenant  uuid,
  p_produit text,
  p_pays    uuid
)
returns table (produit_id uuid, entrepot_id uuid, cas text, raison text, note text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entrepot uuid;
  v_nom_ent  text;
  p          record;
begin
  if p_pays is null then
    return query select null::uuid, null::uuid, 'sans_pays'::text,
      'Pays du client inconnu : impossible de choisir un entrepôt.'::text,
      'Pays du client inconnu : impossible de choisir un entrepôt.'::text;
    return;
  end if;

  v_entrepot := public.entrepot_du_pays(p_tenant, p_pays);
  if v_entrepot is null then
    return query select null::uuid, null::uuid, 'pays_sans_entrepot'::text, x.t, x.t
      from (select 'Aucun entrepôt dans le pays de la commande ('
                   || coalesce((select pa.nom from public.pays pa where pa.id = p_pays), '?')
                   || ') : créez-le dans Paramètres.' as t) x;
    return;
  end if;

  select * into p from public.produit_de_commande(p_tenant, p_produit);
  if p.produit_id is null then
    return query select null::uuid, v_entrepot, p.cas, p.raison,
      case when p.cas = 'produit_inconnu' then null else p.raison end;
    return;
  end if;

  if exists (select 1 from public.stocks s
              where s.produit_id = p.produit_id and s.entrepot_id = v_entrepot) then
    return query select p.produit_id, v_entrepot, 'resolu'::text, null::text, null::text;
    return;
  end if;

  select coalesce(e.nom, '?') into v_nom_ent from public.entrepots e where e.id = v_entrepot;
  return query select p.produit_id, v_entrepot, 'non_stocke'::text, x.t, null::text
    from (select 'Produit « ' || btrim(p_produit) || ' » non déclaré dans l''entrepôt '
                 || v_nom_ent || ' : la livraison en sortira quand même, son stock y passera en négatif.' as t) x;
end;
$$;

-- Seuls les triggers et l'éditeur SQL l'appellent (ils tournent en
-- propriétaire). Le navigateur ne demande pas où sont rangés les produits.
revoke all on function public.resoudre_entrepot_commande(uuid, text, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. « Déjà parti ? » — à partir de là, l'entrepôt est un fait
-- ---------------------------------------------------------------------
-- Une livraison à a_preparer n'a encore rien fait sortir ; expedie, livre
-- et retour, si. stock_ajuste rempli : le stock a déjà bougé.
create or replace function public.commande_expediee(p_commande uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.livraisons l
                  where l.commande_id = p_commande
                    and l.statut in ('expedie', 'livre', 'retour'))
      or exists (select 1 from public.commandes c
                  where c.id = p_commande and c.stock_ajuste is not null);
$$;

revoke all on function public.commande_expediee(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. Le trigger : remplit, recalcule, et garde
-- ---------------------------------------------------------------------
-- · entrepôt NON fourni (insert sans entrepot_id, ou update qui ne le
--   touche pas) : l'entrepôt du pays, à la création et quand le pays change
--   avant le départ. Une fois parti, l'entrepôt d'où il est parti reste —
--   même si le pays est corrigé après coup : c'est un fait, pas un calcul.
-- · entrepôt FOURNI (le responsable à l'import, ou n'importe qui depuis la
--   console) : accepté s'il est celui du pays de la commande, dans son
--   entreprise ; refusé sinon, avec le nom du bon. Refuser, jamais réparer
--   en silence (CLAUDE.md §6.17).
--   Choisir un entrepôt ou choisir un pays, c'est donc le même geste : le
--   responsable voit des entrepôts, le vendeur des pays, les deux arrivent
--   à la même ligne. Pas d'id d'entrepôt montré au vendeur, rien d'ouvert.
-- · la note du produit est recalculée quand le produit ou le pays change,
--   avant le départ. Pas quand seul entrepot_id change : c'est
--   fn_ajuster_stock_livraison qui l'écrit alors, avec sa propre note.
create or replace function public.entrepot_commande_auto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v_donne    boolean;
  v_parti    boolean := false;
  v_recalcul boolean;
begin
  if tg_op = 'UPDATE'
     and new.produit     is not distinct from old.produit
     and new.pays_id     is not distinct from old.pays_id
     and new.entrepot_id is not distinct from old.entrepot_id then
    return new;
  end if;

  select * into r from public.resoudre_entrepot_commande(new.tenant_id, new.produit, new.pays_id);

  if tg_op = 'INSERT' then
    v_donne    := new.entrepot_id is not null;
    v_recalcul := true;
  else
    v_donne    := new.entrepot_id is distinct from old.entrepot_id;
    v_parti    := public.commande_expediee(new.id);
    v_recalcul := not v_parti and (new.produit is distinct from old.produit
                                   or new.pays_id is distinct from old.pays_id);
  end if;

  if v_donne then
    if new.entrepot_id is distinct from r.entrepot_id then
      raise exception using
        errcode = 'check_violation',
        message = 'Entrepôt refusé : une commande part de l''entrepôt de son pays ('
          || coalesce((select e.nom from public.entrepots e where e.id = r.entrepot_id),
                      'ce pays n''a pas d''entrepôt')
          || '), jamais d''un autre.',
        hint = 'Changez le pays de la commande ; l''entrepôt suit.';
    end if;
  elsif v_recalcul then
    new.entrepot_id := r.entrepot_id;
  end if;

  if v_recalcul then
    new.stock_note := r.note;
  end if;
  return new;
end;
$$;

-- Les triggers BEFORE d'une table passent dans l'ordre alphabétique de leur
-- nom. Celui-ci doit passer APRÈS trg_set_tenant_id_commandes (qui remplit
-- tenant_id) : d'où « zz ». entrepot_id est dans la liste pour la garde.
-- « create or replace » : pas un instant sans trigger, la production tourne.
create or replace trigger trg_zz_entrepot_commande
  before insert or update of produit, pays_id, entrepot_id on public.commandes
  for each row execute function public.entrepot_commande_auto();


-- ---------------------------------------------------------------------
-- 6. À la livraison
-- ---------------------------------------------------------------------
-- Changements par rapport au 21/10 :
--   · l'entrepôt : celui de la commande, sinon celui de son pays — plus
--     jamais « aucun » parce que le produit n'y est pas rangé ;
--   · produit au catalogue sans ligne de stock dans cet entrepôt : le
--     mouvement est fait (le trigger du stock crée la ligne à 0, elle passe
--     en négatif) et la note le dit ;
--   · produit introuvable : toujours aucun mouvement, une note.
-- Le reste (pas de double décompte, quantité, la livraison jamais bloquée,
-- l'entrepôt utilisé écrit sur la commande) est inchangé.
-- 26/10 : corps recopié de stock_livraison_autre_vendeur.sql (contrôle du
-- vendeur à la livraison), pour que relancer ce fichier ne remette pas
-- l'ancienne version. Une seule version : modifier les deux ensemble.
-- GARDE (02/11) : fn_ajuster_stock_livraison est définie aujourd'hui par stock_livraison_autre_vendeur.sql.
-- Ce fichier ne la réécrit que si elle manque, n'a pas de marque, porte la
-- sienne ou celle d'un fichier plus ancien. Marquée par un fichier plus
-- récent → gardée telle quelle, avec un avis (rien n'échoue).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.fn_ajuster_stock_livraison()'), 'pg_proc');
begin
  if v_marque in ('fichier: stock_livraison_autre_vendeur.sql') then
    raise notice 'entrepot_commande.sql : fn_ajuster_stock_livraison gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.fn_ajuster_stock_livraison()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cmd        public.commandes%rowtype;
  v_type       text;
  v_quantite   integer;
  v_produit    uuid;
  v_proprio    uuid;
  v_entrepot   uuid;
  v_note       text;
  v_sans_ligne boolean := false;
  p            record;
begin
  -- --- Que vient-il de se passer ? ---------------------------------------
  -- INSERT et UPDATE sont traités séparément : sur INSERT, `OLD` n'existe
  -- pas, et le lire lève une erreur qui ferait échouer toute la livraison.
  if tg_op = 'INSERT' then
    if new.statut = 'livre' then
      v_type := 'sortie';
    else
      return new;
    end if;
  else
    if old.statut is not distinct from new.statut then
      return new;
    end if;

    if new.statut = 'livre' then
      v_type := 'sortie';
    elsif old.statut = 'livre' then
      -- Livrée puis dé-livrée : la marchandise revient au dépôt.
      v_type := 'retour_ok';
    else
      return new;
    end if;
  end if;

  select * into v_cmd from public.commandes c where c.id = new.commande_id;
  if not found then
    return new;
  end if;

  -- --- A-t-on déjà compté ? ----------------------------------------------
  -- La preuve est `stock_ajuste`, pas le statut : le statut peut être remis
  -- à `livre` autant de fois qu'un manager le souhaite.
  if v_type = 'sortie' and v_cmd.stock_ajuste is not null then
    return new;
  end if;
  if v_type = 'retour_ok' and v_cmd.stock_ajuste is null then
    -- Rien n'est jamais sorti : il n'y a rien à rendre.
    return new;
  end if;

  -- --- Combien ? ----------------------------------------------------------
  -- Une commande sans quantité est une commande d'une unité : c'est le cas
  -- courant en COD, et refuser de compter serait pire que compter 1.
  v_quantite := coalesce(v_cmd.quantite, 1);
  if v_quantite <= 0 then
    v_note := 'Quantité ' || v_quantite || ' : rien à décompter.';
  end if;

  -- --- Quel dépôt, quel produit ? -----------------------------------------
  if v_note is null then
    v_entrepot := coalesce(v_cmd.entrepot_id,
                           public.entrepot_du_pays(v_cmd.tenant_id, v_cmd.pays_id));
    if v_entrepot is null then
      v_note := 'Aucun entrepôt dans le pays de la commande : rien à décompter.';
    else
      select * into p from public.produit_de_commande(v_cmd.tenant_id, v_cmd.produit);
      v_produit := p.produit_id;
      if v_produit is null then
        -- On ne sait pas quoi sortir.
        v_note := p.raison;
      elsif v_type = 'sortie' then
        -- Le stock d'un autre vendeur (26/10, stock_livraison_autre_vendeur.sql).
        -- Seulement quand les DEUX ont un vendeur : un produit sans vendeur
        -- (hérité) ou une commande sans vendeur se comportent comme avant.
        -- Pas au retour : ce qui est sorti revient au même produit.
        -- Lu par to_jsonb : ce corps est aussi celui d'entrepot_commande.sql,
        -- qui peut tourner sur une base sans produits.vendeur_id (NULL alors :
        -- comportement d'avant).
        select (to_jsonb(pr) ->> 'vendeur_id')::uuid into v_proprio
          from public.produits pr where pr.id = v_produit;
        if v_cmd.vendeur_id is not null and v_proprio is not null
           and v_proprio <> v_cmd.vendeur_id then
          v_note := 'Le produit « ' || btrim(v_cmd.produit) || ' » est celui d''un autre vendeur :'
                    || ' aucun mouvement de stock. Corrigez le produit ou le vendeur de la commande.';
        else
          v_sans_ligne := not exists (select 1 from public.stocks s
                                       where s.produit_id = v_produit and s.entrepot_id = v_entrepot);
        end if;
      end if;
    end if;
  end if;

  -- --- Ce qui n'a pas pu être fait se dit ---------------------------------
  -- La livraison n'est JAMAIS bloquée : le livreur est devant le client, le
  -- problème est au bureau. Mais il est écrit noir sur blanc.
  if v_note is not null then
    update public.commandes set stock_note = v_note where id = v_cmd.id;
    return new;
  end if;

  -- --- Le mouvement, et rien d'autre --------------------------------------
  -- Sans ligne de stock, trg_actualiser_stock la crée à 0 : le stock passe
  -- en négatif. C'est vrai, et la note le dit.
  insert into public.mouvements_stock
    (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
  values
    (v_cmd.tenant_id, v_produit, v_entrepot, v_type, v_quantite,
     case v_type when 'sortie' then 'Livraison commande ' else 'Retour livraison commande ' end
       || v_cmd.id);

  update public.commandes
     set stock_ajuste = case when v_type = 'sortie' then now() else null end,
         stock_note   = case when v_sans_ligne then
                          'Livré sans stock déclaré dans l''entrepôt '
                          || coalesce((select e.nom from public.entrepots e where e.id = v_entrepot), '?')
                          || ' : son stock y est passé en négatif. Déclarez l''entrée de la marchandise.'
                        end,
         entrepot_id  = v_entrepot
   where id = v_cmd.id;

  return new;
end;
$$
$def$;
  comment on function public.fn_ajuster_stock_livraison() is 'fichier: entrepot_commande.sql';
end $garde$;


-- ---------------------------------------------------------------------
-- 7. Le rattrapage des commandes existantes — DÉFINI ici, APPELÉ par le
--    fichier 2 (entrepot_commande_2_rattrapage.sql)
-- ---------------------------------------------------------------------
-- Chaque commande pas encore partie reçoit l'entrepôt de son pays et la
-- note de la nouvelle règle — produit inconnu compris. Seules les lignes
-- qui changent sont écrites et comptées. Celles déjà parties ne sont pas
-- touchées : celles qui n'ont pas d'entrepôt sont comptées à part, sous
-- « deja_expediee ».
-- Rejouable : au second passage, plus rien ne change.
create or replace function public.remplir_entrepots_commandes()
returns table (cas text, produit text, nombre bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'Réservé à l''éditeur SQL.';
  end if;

  return query
  with cible as (
    select c.id, c.produit, r.entrepot_id, r.cas, r.note
      from public.commandes c
     cross join lateral public.resoudre_entrepot_commande(c.tenant_id, c.produit, c.pays_id) r
     where not public.commande_expediee(c.id)
       and (c.entrepot_id is distinct from r.entrepot_id
            or c.stock_note is distinct from r.note)
  ), maj as (
    update public.commandes c
       set entrepot_id = t.entrepot_id,
           stock_note  = t.note
      from cible t
     where c.id = t.id
    returning c.id
  )
  select t.cas, t.produit, count(*) from cible t group by 1, 2
  union all
  select 'deja_expediee'::text, c.produit, count(*)
    from public.commandes c
   where c.entrepot_id is null and public.commande_expediee(c.id)
   group by 2
  order by 1, 3 desc;
end;
$$;

revoke all on function public.remplir_entrepots_commandes() from public, anon, authenticated;

-- Pas d'appel ici : voir entrepot_commande_2_rattrapage.sql.


-- ---------------------------------------------------------------------
-- 8. La porte « en stock ? » — pour l'import CSV et l'écran Commandes
-- ---------------------------------------------------------------------
-- Pour un pays et une liste de produits : ceux qui ont une quantité
-- disponible > 0 dans l'entrepôt de ce pays. Le vendeur ne lit pas
-- `stocks` (RLS) ; il obtient ici la même réponse que le responsable, pour
-- que les deux voient le même avertissement.
--
-- Ce qu'elle dit : un oui/non par produit DE SON ENTREPRISE, dans un pays
-- DE SON ENTREPRISE. Ce qu'elle ne dit pas : aucune quantité, aucun nom ni
-- id d'entrepôt, rien sur une autre entreprise (pays ou produit étranger →
-- rien). Un vendeur apprend si le produit d'un autre vendeur de la même
-- entreprise est en rupture — de la même famille que pays_du_produit, déjà
-- ouverte.
--
-- « > 0 » ici, pas « ≥ la quantité de la commande » : c'est un
-- avertissement par produit, pas le contrôle de la confirmation.
-- GARDE (02/11) : produits_en_stock est définie aujourd'hui par produits_proprietaire.sql.
-- Ce fichier ne la réécrit que si elle manque, n'a pas de marque, porte la
-- sienne ou celle d'un fichier plus ancien. Marquée par un fichier plus
-- récent → gardée telle quelle, avec un avis (rien n'échoue).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.produits_en_stock(uuid, uuid[])'), 'pg_proc');
begin
  if v_marque in ('fichier: produits_proprietaire.sql') then
    raise notice 'entrepot_commande.sql : produits_en_stock gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.produits_en_stock(p_pays uuid, p_produits uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.produit_id
    from public.entrepots e
    join public.stocks    s on s.entrepot_id = e.id and s.tenant_id = e.tenant_id
   where e.pays_id = p_pays
     and s.produit_id = any (coalesce(p_produits, '{}'::uuid[]))
     and s.quantite_disponible > 0
     -- Le contrôle d'entreprise, à la main : en SECURITY DEFINER il n'y a
     -- plus de RLS pour le faire.
     and (public.is_super_admin() or e.tenant_id = public.get_my_tenant_id());
$$
$def$;
  comment on function public.produits_en_stock(uuid, uuid[]) is 'fichier: entrepot_commande.sql';
end $garde$;

revoke all on function public.produits_en_stock(uuid, uuid[]) from public, anon;
grant execute on function public.produits_en_stock(uuid, uuid[]) to authenticated;
