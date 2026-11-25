-- =====================================================================
-- LIVRAISON : LE STOCK D'UN AUTRE VENDEUR NE BOUGE PAS — 26/10/2026
-- Un seul fichier. Ne modifie AUCUNE commande ni aucun stock existant.
-- Rejouable. À lancer après produits_proprietaire.sql (déjà en place).
-- =====================================================================
--
-- Pourquoi : depuis produits_proprietaire.sql, un produit a un vendeur, et
-- son stock est celui que ce vendeur a fait entrer. Mais le produit d'une
-- commande se lit à l'échelle de l'entreprise (produit_de_commande — exprès,
-- elle répond à « quel produit est-ce ? »). Un lead du vendeur A qui nomme
-- le produit du vendeur B, une fois livré, sortait donc la marchandise du
-- stock de B : la vente de A, payée par le stock de B.
-- Le 26/10 : 0 commande dans ce cas dans la vraie entreprise. Préventif.
--
-- La règle, à la livraison (`sortie`) :
--   · la commande a un vendeur, le produit a un vendeur, et ce ne sont pas
--     les mêmes → AUCUN mouvement de stock, et une note sur la commande
--     qui dit pourquoi. Même traitement qu'un produit inconnu : la
--     livraison n'est jamais bloquée (le livreur est devant le client), le
--     problème est au bureau, et il est écrit.
--   · produit sans vendeur (cas hérité), ou commande sans vendeur (import
--     d'un responsable) → comme avant.
--   · la note ne nomme pas l'autre vendeur : le vendeur de la commande la
--     lit, et les produits des autres ne le regardent pas.
--
-- Le RETOUR (`retour_ok`, livrée puis dé-livrée) n'est PAS contrôlé, exprès :
-- il ne passe que si une sortie a eu lieu (stock_ajuste), et ce qui est
-- sorti doit revenir au même produit, même si son vendeur a changé entre-
-- temps. Le bloquer perdrait de la marchandise.
--
-- Une seule fonction change : fn_ajuster_stock_livraison. Son corps est
-- celui de la prod du 26/10 (entrepot_commande.sql, 22/10), plus le contrôle.
-- La même version est recopiée dans entrepot_commande.sql : relancer ce
-- fichier-là ne remet pas l'ancienne. (Depuis le 02/11, entrepot_commande.sql
-- voit la marque de CE fichier et ne réécrit plus sa copie.)
--
-- 03/11/2026 — LA NOTE QUAND LE STOCK NE SUFFIT PAS (sa décision : option A).
-- Une commande livrée sortait sa quantité même quand la ligne de stock de
-- l'entrepôt ne la contenait pas — c'est voulu, la livraison n'est jamais
-- bloquée — mais la note « son stock y est passé en négatif » n'était écrite
-- que si la ligne N'EXISTAIT PAS. Une ligne à 0 (celle que crée
-- rattacher_produit_pays) passait en négatif EN SILENCE : le -1 de
-- FG0000000211 (« product c », entrepôt Angola, 03/11), sans note. Désormais,
-- ligne absente OU ligne qui ne contient pas la quantité livrée → la
-- commande le dit, avec les chiffres. Toujours aucun refus, aucun autre
-- changement ; les commandes déjà livrées ne sont pas touchées (le -1 reste
-- tel quel, sa décision).
--
-- 03/11/2026 (2) — LA LIVRAISON LIT LE LIEN ENREGISTRÉ. Elle relisait le
-- produit depuis le TEXTE de la commande (produit_de_commande), en ignorant
-- commandes.produit_id. Avec les correspondances SKU (correspondances_sku.sql),
-- le lien vient d'un SKU que le texte ne contient pas : sans ce changement, une
-- commande liée ne sortirait rien du stock. Désormais : produit_id s'il existe
-- (et que le produit existe encore), sinon la règle du texte comme avant. Seul
-- effet sur une commande d'avant : un produit RENOMMÉ depuis la commande sort
-- maintenant son stock (le lien est gardé au renommage, 29/10) au lieu de
-- « introuvable ».
-- RETOUR ARRIÈRE : stock_livraison_autre_vendeur_retour.sql (copie sur le
-- Bureau : RETOUR_stock_livraison_autre_vendeur.sql) = le corps lu en prod le
-- 03/11 (md5 8226f286b1d0731294abcabb6cbc7ce4).
--
-- 05/11 (3) — RÈGLES DE STOCK (sa décision) : le stock sort à « expédiée »
-- (le livreur prend le colis) ou à « livrée » directe ; revient au retour /
-- à l'annulation d'un colis pris ; « expédiée » REFUSÉE si le stock n'y est
-- pas (« Rupture : … »). Voir stock_regles.sql pour la rupture à l'arrivée et
-- à la confirmation. Retour arrière au corps du 04/11 : stock_livraison_autre_vendeur_retour_04_11.sql. (nettoyage_triggers_14_10.sql porte
-- une version bien plus ancienne : ne pas le relancer, c'était déjà vrai.)
-- =====================================================================


-- §1 — Le prérequis ---------------------------------------------------------
-- Sans produits.vendeur_id, le contrôle n'a rien à lire.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'produits'
                    and column_name = 'vendeur_id') then
    raise exception 'Arrêt : produits.vendeur_id absent. Lancez produits_proprietaire.sql d''abord. Rien n''a été installé.';
  end if;
end $$;


-- §2 — La fonction --------------------------------------------------------------
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
  v_dispo      integer;            -- 03/11 : ce que la ligne contenait AVANT la sortie
  v_court      boolean := false;   -- 03/11 : la ligne existe mais ne contient pas la quantité
  p            record;
begin
  -- --- Que vient-il de se passer ? ---------------------------------------
  -- INSERT et UPDATE sont traités séparément : sur INSERT, `OLD` n'existe
  -- pas, et le lire lève une erreur qui ferait échouer toute la livraison.
  -- 05/11 (règles de stock, sa décision) : le stock SORT quand le livreur
  -- PREND le colis — « expédiée » — ou à « livrée » s'il n'est pas passé par
  -- « expédiée ». Il REVIENT au retour, ou à l'annulation d'un colis déjà pris.
  -- (Avant : sortie à « livrée » seulement.) stock_ajuste reste la preuve
  -- qu'on a compté : jamais deux sorties pour une commande.
  if tg_op = 'INSERT' then
    if new.statut in ('expedie', 'livre') then
      v_type := 'sortie';
    else
      return new;
    end if;
  else
    if old.statut is not distinct from new.statut then
      return new;
    end if;

    if new.statut in ('expedie', 'livre') then
      v_type := 'sortie';
    elsif old.statut in ('expedie', 'livre') then
      -- Le colis pris revient (retour, annulée, ou remise « à préparer ») : au dépôt.
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
      -- 03/11 : le lien enregistré sur la commande d'abord (commandes.produit_id,
      -- posé par les triggers : texte du catalogue, ou correspondance SKU de la
      -- source — correspondances_sku.sql). Sans lien, la règle du texte, comme
      -- avant. Lu par to_jsonb : ce corps doit aussi tourner sur une base sans
      -- la colonne (les tests anciens).
      v_produit := (to_jsonb(v_cmd) ->> 'produit_id')::uuid;
      if v_produit is not null and not exists (select 1 from public.produits pr where pr.id = v_produit) then
        v_produit := null;
      end if;
      if v_produit is null then
        select * into p from public.produit_de_commande(v_cmd.tenant_id, v_cmd.produit);
        v_produit := p.produit_id;
      end if;
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
          -- Lu AVANT le mouvement (trg_actualiser_stock le décompte ensuite).
          select s.quantite_disponible into v_dispo from public.stocks s
           where s.produit_id = v_produit and s.entrepot_id = v_entrepot;
          v_sans_ligne := not found;
          v_court      := found and coalesce(v_dispo, 0) < v_quantite;
        end if;
      end if;
    end if;
  end if;

  -- --- « Expédiée » sans stock : refusée (05/11, sa décision) -------------
  -- Le livreur ne peut pas prendre un colis que le stock n'a pas. Il n'est pas
  -- devant le client : refuser ici est sûr, et empêche le stock négatif.
  -- « Livrée » directement, elle, n'est JAMAIS refusée (le livreur est à la
  -- porte) : elle sort et la note le dit, comme avant.
  if v_type = 'sortie' and new.statut = 'expedie' and v_note is null and (v_sans_ligne or v_court) then
    raise exception 'Rupture : % disponible(s) de « % » dans l''entrepôt % — impossible de prendre % colis. Prévenez le bureau.',
      coalesce(v_dispo, 0), btrim(v_cmd.produit),
      coalesce((select e.nom from public.entrepots e where e.id = v_entrepot), '?'), v_quantite;
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
                        when v_court then
                          'Livré avec un stock insuffisant dans l''entrepôt '
                          || coalesce((select e.nom from public.entrepots e where e.id = v_entrepot), '?')
                          || ' : ' || coalesce(v_dispo, 0) || ' disponible(s) pour ' || v_quantite
                          || ' livré(s), son stock y est maintenant à ' || (coalesce(v_dispo, 0) - v_quantite)
                          || '. Déclarez l''entrée de la marchandise.'
                        end,
         entrepot_id  = v_entrepot
   where id = v_cmd.id;

  return new;
end;
$$;
-- Marque (02/11) : ce fichier définit fn_ajuster_stock_livraison. Les fichiers plus anciens qui
-- en ont une copie la lisent et ne la réécrivent plus.
comment on function public.fn_ajuster_stock_livraison() is 'fichier: stock_livraison_autre_vendeur.sql';


-- §3 — Vérification ----------------------------------------------------------
-- Les deux triggers de livraison appellent bien cette fonction, et elle
-- porte le contrôle.
do $$
begin
  if (select count(*) from pg_trigger
       where tgrelid = 'public.livraisons'::regclass
         and tgname in ('trg_ajuster_stock_livraison_insert', 'trg_ajuster_stock_livraison_update')
         and tgfoid = 'public.fn_ajuster_stock_livraison()'::regprocedure
         and tgenabled <> 'D') <> 2 then
    raise exception 'Les triggers trg_ajuster_stock_livraison_insert/_update manquent ou sont désactivés.';
  end if;
  -- « autre vendeur » sans apostrophe : dans le source de la fonction, elle
  -- est doublée (d''un), la chercher simple ne la trouverait jamais.
  if position('est celui d' in
              pg_get_functiondef('public.fn_ajuster_stock_livraison()'::regprocedure)) = 0
     or position('autre vendeur' in
              pg_get_functiondef('public.fn_ajuster_stock_livraison()'::regprocedure)) = 0 then
    raise exception 'fn_ajuster_stock_livraison ne porte pas le contrôle du vendeur.';
  end if;
  if position('to_jsonb(v_cmd) ->> ''produit_id''' in
              pg_get_functiondef('public.fn_ajuster_stock_livraison()'::regprocedure)) = 0 then
    raise exception 'fn_ajuster_stock_livraison ne lit pas commandes.produit_id (03/11).';
  end if;
  if position('Rupture : % disponible(s)' in
              pg_get_functiondef('public.fn_ajuster_stock_livraison()'::regprocedure)) = 0 then
    raise exception 'fn_ajuster_stock_livraison ne porte pas les règles de stock du 05/11.';
  end if;
  if position('stock insuffisant' in
              pg_get_functiondef('public.fn_ajuster_stock_livraison()'::regprocedure)) = 0 then
    raise exception 'fn_ajuster_stock_livraison ne porte pas la note « stock insuffisant » (03/11).';
  end if;
  raise notice 'Livraison : contrôle du vendeur et note « stock insuffisant » en place.';
end $$;
