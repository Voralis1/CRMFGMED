-- =====================================================================
-- REMPLACÉ LE 23/10/2026 PAR produits_historique_nom.sql — NE PAS REJOUER.
-- La règle était à l'envers : un produit se supprime toujours, c'est son
-- historique (mouvements, lignes d'expédition) qui reste, avec son nom.
-- Rejouer ce fichier remettrait le refus et les clés RESTRICT : le bloc
-- ci-dessous arrête tout s'il trouve le nouveau fichier déjà appliqué.
-- =====================================================================
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'mouvements_stock'
                and column_name = 'produit_nom') then
    raise exception 'produits_suppression.sql est remplacé par produits_historique_nom.sql (déjà appliqué) : rien n''a été modifié.';
  end if;
end $$;

-- =====================================================================
-- SUPPRIMER UN PRODUIT SANS EFFACER SON HISTORIQUE — 23/10/2026
-- Un seul fichier. Ne modifie AUCUNE donnée existante. Rejouable.
-- =====================================================================
--
-- Le trou : stocks.produit_id et mouvements_stock.produit_id étaient en
-- ON DELETE CASCADE. Supprimer un produit effaçait ses lignes de stock ET
-- tout son historique de mouvements — pour n'importe qui, propriétaire
-- légitime compris. Un historique de mouvements est une pièce comptable.
-- Seul expeditions_produits (RESTRICT) bloquait, et seulement si le produit
-- avait déjà été expédié.
--
-- La règle : un produit qui a un historique ne se supprime pas ; le refus
-- dit ce qui le retient. Un produit SANS historique se supprime toujours :
-- une faute de frappe deux minutes après la création doit pouvoir partir.
-- (23/10, reprise : le message ne propose plus d'archiver — aucun écran ne
-- le permet.)
--
-- L'historique, c'est :
--   · une ligne dans mouvements_stock ;
--   · une ligne dans expeditions_produits (compté en expéditions) ;
--   · une ligne de stock dont une quantité n'est pas zéro (disponible,
--     défectueuse ou réservée — NÉGATIF COMPRIS : un stock négatif dit qu'on
--     a vendu ce qui n'avait pas été déclaré, c'est un fait) ;
--   · une commande qui le nomme.
--
-- COMMANDES — commandes.produit est du TEXTE, pas une référence. On compte
-- une commande de l'entreprise du produit quand, sans accents, sans casse et
-- sans espaces en trop (la normalisation de produit_de_commande) :
--   · son texte, ou l'un des morceaux séparés par « + » (commandes à
--     plusieurs produits, « A ×2 + B ×1 », le « ×N » retiré), est égal au
--     CODE ou au NOM du produit ;
--   · ou l'une de ses lignes commandes.articles (API) porte ce nom ou ce code.
-- Ce que ça manque, dit franchement :
--   · une commande écrite avec un ANCIEN nom ou code, avant un renommage ;
--   · un texte avec des mots en plus (« Clearzal 2 boîtes ») ou mal
--     orthographié — ces commandes ne pointaient déjà vers aucun produit
--     (produit_inconnu), le stock ne les a jamais décomptées.
-- Et ce que ça compte en trop : deux produits au même nom comptent tous les
-- deux la commande. Pour BLOQUER une suppression, compter large est le bon
-- côté (§6.15 de CLAUDE.md).
--
-- Ce que fait le fichier :
--   §1  historique_produit(produit) → la liste de ce qui bloque, en clair.
--   §2  trigger BEFORE DELETE sur produits : refuse avec la liste
--       (« Clearzal » ne peut pas être supprimé : 14 mouvements de stock,
--       1 expédition, 11 commandes.) — même forme que
--       supprimer_pays. Sinon, il retire lui-même les lignes de stock à zéro
--       (le travail que faisait la cascade) et laisse supprimer.
--       Aucune exemption : navigateur, Edge Functions, éditeur SQL.
--   §3  les deux clés étrangères passent en RESTRICT : même trigger
--       désactivé, une suppression ne peut plus effacer un historique.
--   §4  rattacher_produit_pays : une ligne de stock NÉGATIVE n'est plus
--       prise pour une ligne vide (elle était supprimée en retirant un pays,
--       ce qui remettait un stock négatif à zéro sans aucun mouvement).
--   §5  la vérification, et une vraie tentative de suppression, annulée.
--
-- Vérifié avant d'écrire (23/10, lecture seule) : aucun chemin légitime ne
-- comptait sur la cascade. vider_donnees_operationnelles vide
-- mouvements_stock lui-même et ne supprime aucun produit ; supprimer_pays et
-- rattacher_produit_pays suppriment des lignes de stock, jamais un produit ;
-- produits n'a pas de clé vers tenants (supprimer une entreprise ne passe
-- pas par là) ; commandes_test_2_suppression.sql ne touche pas aux produits.
-- Les deux écrans qui suppriment (Produits, Paramètres → Catalogue)
-- envoient un simple DELETE : ils recevront le message du §2.
-- =====================================================================


-- §1 — Ce qui bloque ---------------------------------------------------------
-- La normalisation de produit_de_commande, en une fonction, pour que les deux
-- comparent de la même façon.
create or replace function public.nom_produit_normalise(p_texte text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(regexp_replace(btrim(public.unaccent_simple(coalesce(p_texte, ''))), '\s+', ' ', 'g')), '');
$$;

-- SECURITY DEFINER : le compte doit être complet quel que soit l'appelant
-- (un vendeur ne lit ni stocks ni mouvements_stock ; il ne doit pas pour
-- autant pouvoir supprimer ce qu'il ne voit pas).
create or replace function public.historique_produit(p_produit uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v      public.produits%rowtype;
  v_cles text[];
  v_bloc text[] := '{}';
  n      bigint;
begin
  select * into v from public.produits where id = p_produit;
  if not found then
    return v_bloc;
  end if;

  select count(*) into n from public.mouvements_stock where produit_id = p_produit;
  if n > 0 then
    v_bloc := v_bloc || format('%s mouvement%s de stock', n, case when n > 1 then 's' else '' end);
  end if;

  select count(distinct expedition_id) into n from public.expeditions_produits where produit_id = p_produit;
  if n > 0 then
    v_bloc := v_bloc || format('%s expédition%s', n, case when n > 1 then 's' else '' end);
  end if;

  select count(*) into n from public.stocks
   where produit_id = p_produit
     and (coalesce(quantite_disponible, 0) <> 0
          or coalesce(quantite_defectueuse, 0) <> 0
          or coalesce(quantite_reservee, 0) <> 0);
  if n > 0 then
    v_bloc := v_bloc || format('%s ligne%s de stock non nulle%s', n,
                               case when n > 1 then 's' else '' end,
                               case when n > 1 then 's' else '' end);
  end if;

  v_cles := array_remove(array[public.nom_produit_normalise(v.code),
                               public.nom_produit_normalise(v.product)], null);
  if cardinality(v_cles) > 0 then
    select count(*) into n
      from public.commandes c
     where c.tenant_id = v.tenant_id
       and (
         exists (select 1
                   from regexp_split_to_table(coalesce(c.produit, ''), '\s\+\s') as morceau
                  where public.nom_produit_normalise(regexp_replace(morceau, '\s*×\s*\d+\s*$', '')) = any (v_cles))
         or exists (select 1
                      from jsonb_array_elements(case when jsonb_typeof(c.articles) = 'array'
                                                     then c.articles else '[]'::jsonb end) as a
                     where public.nom_produit_normalise(a->>'produit') = any (v_cles)
                        or public.nom_produit_normalise(a->>'code')    = any (v_cles))
       );
    if n > 0 then
      v_bloc := v_bloc || format('%s commande%s', n, case when n > 1 then 's' else '' end);
    end if;
  end if;

  return v_bloc;
end;
$$;

revoke all on function public.historique_produit(uuid) from public, anon, authenticated;


-- §2 — Le refus ---------------------------------------------------------------
-- SECURITY DEFINER : pour un produit sans historique, il retire ses lignes de
-- stock à zéro, que le vendeur ne peut pas écrire lui-même (c'est ce que la
-- cascade faisait, en passant outre la RLS).
create or replace function public.produit_suppression_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bloc text[];
begin
  v_bloc := public.historique_produit(old.id);
  if cardinality(v_bloc) > 0 then
    raise exception '« % » ne peut pas être supprimé : %.',
      old.product, array_to_string(v_bloc, ', ')
      using errcode = 'restrict_violation';
  end if;

  -- Rien à garder : ses lignes de stock sont toutes à zéro (sinon on
  -- serait sorti plus haut).
  delete from public.stocks where produit_id = old.id;
  return old;
end;
$$;

revoke all on function public.produit_suppression_garde() from public, anon, authenticated;

drop trigger if exists trg_produits_suppression on public.produits;
create trigger trg_produits_suppression
  before delete on public.produits
  for each row execute function public.produit_suppression_garde();


-- §3 — Plus jamais de cascade sur l'historique --------------------------------
-- Supprimer puis recréer, dans la même transaction : à aucun moment la table
-- n'est sans clé. Les lignes existantes sont toutes valides (la clé existait).
alter table public.stocks           drop constraint if exists stocks_produit_id_fkey;
alter table public.stocks           add  constraint stocks_produit_id_fkey
  foreign key (produit_id) references public.produits(id) on delete restrict;

alter table public.mouvements_stock drop constraint if exists mouvements_stock_produit_id_fkey;
alter table public.mouvements_stock add  constraint mouvements_stock_produit_id_fkey
  foreign key (produit_id) references public.produits(id) on delete restrict;


-- §4 — rattacher_produit_pays : un stock négatif n'est pas un stock vide -------
-- Corps identique à la production (pg_get_functiondef, 23/10), sauf la ligne
-- « plein » : `> 0` devient `<> 0`, et la quantité réservée compte aussi.
-- Avant, retirer un pays supprimait une ligne à -2 : le négatif disparaissait
-- sans mouvement, et le rattacher la recréait à zéro.
create or replace function public.rattacher_produit_pays(p_produit uuid, p_pays uuid[])
 returns table(ajoutes integer, retires integer, gardes_pleins integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_pays   uuid[] := coalesce(p_pays, '{}'::uuid[]);
begin
  -- L'entreprise du produit, pas celle que l'appelant prétend.
  select tenant_id into v_tenant from public.produits where id = p_produit;
  if v_tenant is null then
    raise exception 'Produit introuvable';
  end if;

  if not (public.is_super_admin() or v_tenant = public.get_my_tenant_id()) then
    raise exception 'Ce produit n''appartient pas à votre entreprise';
  end if;

  -- Les pays doivent être ceux de l'entreprise, et avoir un entrepôt. Un
  -- identifiant venu d'ailleurs est ignoré, pas refusé : il ne correspond à
  -- aucun entrepôt, donc il ne crée rien.
  with vise as (
    select e.id as entrepot_id
    from public.entrepots e
    where e.tenant_id = v_tenant
      and e.pays_id = any (v_pays)
  ),
  nouveaux as (
    insert into public.stocks (tenant_id, produit_id, entrepot_id,
                               quantite_disponible, quantite_defectueuse)
    select v_tenant, p_produit, v.entrepot_id, 0, 0
    from vise v
    where not exists (
      select 1 from public.stocks s
      where s.produit_id = p_produit and s.entrepot_id = v.entrepot_id
    )
    returning 1
  )
  select count(*)::int into ajoutes from nouveaux;

  -- À retirer : les lignes de ce produit dont l'entrepôt n'est plus dans les
  -- pays choisis. On sépare les vides des pleines. « Pleine » = une quantité
  -- qui n'est pas zéro, NÉGATIVE comprise (23/10).
  with a_retirer as (
    select s.id, (coalesce(s.quantite_disponible, 0) <> 0
                  or coalesce(s.quantite_defectueuse, 0) <> 0
                  or coalesce(s.quantite_reservee, 0) <> 0) as plein
    from public.stocks s
    join public.entrepots e on e.id = s.entrepot_id
    where s.produit_id = p_produit
      and s.tenant_id = v_tenant
      and (e.pays_id is null or not (e.pays_id = any (v_pays)))
  ),
  supprimees as (
    delete from public.stocks
    where id in (select id from a_retirer where not plein)
    returning 1
  )
  select
    (select count(*)::int from supprimees),
    (select count(*)::int from a_retirer where plein)
  into retires, gardes_pleins;

  return next;
end;
$function$;


-- §5 — La vérification ---------------------------------------------------------
-- LÈVE si une pièce manque. Puis deux vraies tentatives, chacune dans un bloc
-- qui finit toujours par une exception : rien ne peut rester supprimé.
do $$
declare
  v_id     uuid;
  v_nom    text;
  v_erreur text;
begin
  if (select confdeltype from pg_constraint where conname = 'stocks_produit_id_fkey'
        and conrelid = 'public.stocks'::regclass) is distinct from 'r' then
    raise exception '§5 : stocks_produit_id_fkey n''est pas en RESTRICT.';
  end if;
  if (select confdeltype from pg_constraint where conname = 'mouvements_stock_produit_id_fkey'
        and conrelid = 'public.mouvements_stock'::regclass) is distinct from 'r' then
    raise exception '§5 : mouvements_stock_produit_id_fkey n''est pas en RESTRICT.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_produits_suppression'
                   and tgrelid = 'public.produits'::regclass and tgenabled <> 'D') then
    raise exception '§5 : le trigger trg_produits_suppression est absent ou désactivé.';
  end if;
  if exists (select 1 from pg_constraint c
              where c.contype = 'f' and c.confrelid = 'public.produits'::regclass
                and c.confdeltype = 'c') then
    raise exception '§5 : il reste une clé en CASCADE vers produits : %',
      (select string_agg(conrelid::regclass || '.' || conname, ', ') from pg_constraint
        where contype = 'f' and confrelid = 'public.produits'::regclass and confdeltype = 'c');
  end if;

  -- Un produit AVEC historique : la suppression doit être refusée, par nous.
  select p.id, p.product into v_id, v_nom
    from public.produits p
   where cardinality(public.historique_produit(p.id)) > 0
   limit 1;
  if v_id is null then
    raise notice '§5 : aucun produit avec historique, tentative de refus impossible.';
  else
    v_erreur := null;
    begin
      delete from public.produits where id = v_id;
      raise exception 'SUPPRESSION_PASSEE';
    exception when others then
      v_erreur := sqlerrm;
    end;
    if v_erreur = 'SUPPRESSION_PASSEE' then
      raise exception '§5 : ÉCHEC — « % » (avec historique) a été supprimé. (Tentative annulée.)', v_nom;
    elsif v_erreur not like '%ne peut pas être supprimé : %' or v_erreur like '%Archivez%' then
      raise exception '§5 : refus inattendu pour « % » : %', v_nom, v_erreur;
    end if;
    raise notice '§5 : refusé comme prévu — %', v_erreur;
  end if;

  -- Un produit SANS historique : la suppression doit passer (puis on annule).
  select p.id, p.product into v_id, v_nom
    from public.produits p
   where cardinality(public.historique_produit(p.id)) = 0
   limit 1;
  if v_id is null then
    raise notice '§5 : aucun produit sans historique, tentative de suppression impossible.';
  else
    v_erreur := null;
    begin
      delete from public.produits where id = v_id;
      raise exception 'SUPPRESSION_PASSEE';
    exception when others then
      v_erreur := sqlerrm;
    end;
    if v_erreur <> 'SUPPRESSION_PASSEE' then
      raise exception '§5 : « % » n''a aucun historique mais sa suppression est refusée : %', v_nom, v_erreur;
    end if;
    raise notice '§5 : « % » (sans historique) se supprime bien — tentative annulée, il est toujours là.', v_nom;
  end if;
end $$;

-- Ce qui bloquerait chaque produit aujourd'hui (lecture seule).
select p.product, p.code, p.statut,
       coalesce(array_to_string(public.historique_produit(p.id), ', '), '') as historique
  from public.produits p
 order by p.tenant_id, p.product;
