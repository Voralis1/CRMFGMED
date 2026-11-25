-- FIXTURE : stock_livraison_autre_vendeur.sql tel que le 02/11 (avant la note « stock insuffisant » du 03/11),
-- pour test_garde_definitions.mjs qui reconstruit l'état du 02/11. Ne pas lancer en prod.
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
-- fichier-là ne remet pas l'ancienne. (nettoyage_triggers_14_10.sql porte
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
  raise notice 'Livraison : contrôle du vendeur en place.';
end $$;
