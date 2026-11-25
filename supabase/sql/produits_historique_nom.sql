-- =====================================================================
-- UN PRODUIT SE SUPPRIME, SON HISTORIQUE RESTE — 23/10/2026
-- Un seul fichier. Rejouable. Remplace produits_suppression.sql (le refus).
-- Données existantes : il REMPLIT deux colonnes neuves (produit_nom,
-- produit_code) sur les mouvements et les lignes d'expédition, et ajoute
-- recu_sans_mouvement (false partout) aux lignes d'expédition. Rien d'autre.
-- =====================================================================
--
-- La règle d'avant (produits_suppression.sql, en production) était à
-- l'envers : un produit avec un historique ne se supprimait plus. Le
-- catalogue était bloqué par sa propre histoire.
--
-- La règle maintenant :
--   · un produit se supprime. Toujours.
--   · ce qui doit survivre, c'est l'HISTORIQUE : les mouvements de stock et
--     les lignes d'expédition. Ils restent, avec leurs quantités et leurs
--     dates, et ils disent encore de quel produit il s'agissait.
--
-- Comment : comme commandes.produit (le NOM en texte, qui survit déjà à la
-- suppression), mouvements_stock et expeditions_produits reçoivent
-- produit_nom et produit_code, écrits par la base à la création de la ligne
-- (et quand produit_id change). Leur clé vers produits passe en
-- ON DELETE SET NULL : la ligne reste, produit_id devient NULL, le nom écrit
-- dit lequel c'était.
--
-- Le nom est FIGÉ à l'écriture, sur les deux tables (une seule fonction pour
-- les deux) : un produit renommé après coup garde son ancien nom dans ces
-- colonnes. Les écrans montrent le nom actuel tant que le produit existe, et
-- le nom écrit une fois qu'il n'existe plus.
--
-- stocks garde ON DELETE CASCADE : une ligne de stock est l'état ACTUEL, pas
-- l'historique ; sans produit elle ne veut rien dire. Les mouvements, eux,
-- restent et expliquent ce stock jusqu'à la suppression.
--
-- Ce que fait le fichier :
--   §1  défait le refus : trigger trg_produits_suppression et ses fonctions
--       (produit_suppression_garde, historique_produit, nom_produit_normalise).
--       La correction de rattacher_produit_pays (un stock négatif n'est pas
--       vide) N'EST PAS touchée : elle reste.
--   §2  les colonnes produit_nom / produit_code, et recu_sans_mouvement
--       (une ligne reçue alors que son produit était déjà supprimé).
--   §3  le remplissage des lignes existantes, puis les triggers qui les écrivent.
--   §4  les clés : SET NULL (mouvements, expéditions), CASCADE (stocks).
--   §5  la vérification, et une vraie suppression, annulée.
--   §6  ce qu'une suppression emporterait aujourd'hui (lecture seule).
--
-- produits.upsell_produit_id / crosssell_produit_id sont déjà en
-- ON DELETE SET NULL : supprimer B efface le lien chez A. Non touchés.
-- =====================================================================


-- §1 — Défaire le refus --------------------------------------------------------
drop trigger if exists trg_produits_suppression on public.produits;
drop function if exists public.produit_suppression_garde();
drop function if exists public.historique_produit(uuid);
drop function if exists public.nom_produit_normalise(text);


-- §2 — Le nom, écrit sur la ligne ----------------------------------------------
alter table public.mouvements_stock
  add column if not exists produit_nom  text,
  add column if not exists produit_code text;

alter table public.expeditions_produits
  add column if not exists produit_nom  text,
  add column if not exists produit_code text;

-- Une ligne dont le produit a été supprimé AVANT la réception : la
-- marchandise arrive, la quantité reçue est notée, mais aucun mouvement de
-- stock n'est créé (receptionner_expedition saute les lignes sans produit).
-- Le compte de l'entrepôt ne la connaît pas. Ce drapeau le dit sur la ligne,
-- pour toujours : sans lui, après coup, on ne distingue plus « supprimé
-- avant la réception » (aucun mouvement) de « supprimé après » (le mouvement
-- existe). Posé par la base (§3), jamais par un écran.
alter table public.expeditions_produits
  add column if not exists recu_sans_mouvement boolean not null default false;


-- §3 — Remplir l'existant, puis écrire à chaque nouvelle ligne ------------------
-- Les triggers d'abord retirés : sinon, au deuxième passage, ils garderaient
-- l'ancienne valeur (vide) et le remplissage ne ferait rien.
drop trigger if exists trg_mouvements_nom_produit on public.mouvements_stock;
drop trigger if exists trg_expeditions_produits_nom on public.expeditions_produits;
drop trigger if exists trg_expeditions_produits_sans_mouvement on public.expeditions_produits;

-- Seulement les lignes encore vides : un nom déjà écrit est un fait, on ne
-- le réécrit pas avec le nom d'aujourd'hui.
update public.mouvements_stock m
   set produit_nom  = p.product,
       produit_code = nullif(btrim(p.code), '')
  from public.produits p
 where p.id = m.produit_id
   and p.tenant_id = m.tenant_id
   and m.produit_nom is null;

update public.expeditions_produits ep
   set produit_nom  = p.product,
       produit_code = nullif(btrim(p.code), '')
  from public.produits p
 where p.id = ep.produit_id
   and p.tenant_id = ep.tenant_id
   and ep.produit_nom is null;

-- SECURITY DEFINER : le nom doit être écrit quel que soit l'appelant
-- (navigateur, receptionner_expedition, fn_ajuster_stock_livraison, clé
-- service). Le filtre sur tenant_id empêche de recopier le nom d'un produit
-- d'une autre entreprise.
create or replace function public.ecrire_nom_produit_historique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Une NOUVELLE ligne sans produit est refusée : un mouvement (ou une
    -- ligne d'expédition) se crée toujours pour un produit. Le NULL qui
    -- arrive par la suppression d'un produit (ON DELETE SET NULL) est un
    -- UPDATE, pas un INSERT : il n'est pas concerné, il passe plus bas.
    if new.produit_id is null then
      raise exception '%', case tg_table_name
          when 'mouvements_stock' then 'Un mouvement de stock doit nommer son produit.'
          else 'Une ligne d''expédition doit nommer son produit.'
        end
        using errcode = 'not_null_violation';
    end if;
  elsif new.produit_id is not distinct from old.produit_id or new.produit_id is null then
    -- Même produit, ou produit supprimé (SET NULL) : le nom écrit ne bouge
    -- pas, même si quelqu'un essaie de l'écrire à la main.
    new.produit_nom  := old.produit_nom;
    new.produit_code := old.produit_code;
    return new;
  end if;

  -- Nouvelle ligne, ou produit_id changé pour un autre produit : on écrit
  -- le nom et le code de ce produit, tels qu'ils sont maintenant. Ce que
  -- l'appelant a envoyé dans ces colonnes est ignoré.
  new.produit_nom  := null;
  new.produit_code := null;
  select p.product, nullif(btrim(p.code), '')
    into new.produit_nom, new.produit_code
    from public.produits p
   where p.id = new.produit_id
     and p.tenant_id = new.tenant_id;
  return new;
end;
$$;

revoke all on function public.ecrire_nom_produit_historique() from public, anon, authenticated;

create trigger trg_mouvements_nom_produit
  before insert or update on public.mouvements_stock
  for each row execute function public.ecrire_nom_produit_historique();

create trigger trg_expeditions_produits_nom
  before insert or update on public.expeditions_produits
  for each row execute function public.ecrire_nom_produit_historique();

-- Le drapeau recu_sans_mouvement. Même condition que receptionner_expedition
-- pour sauter le mouvement (`quantite > 0 and produit_id is not null`), lue
-- au moment où la quantité reçue est écrite. Personne d'autre ne le change.
create or replace function public.marquer_reception_sans_mouvement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.recu_sans_mouvement := false;
  elsif old.quantite_recue is null and new.quantite_recue is not null then
    new.recu_sans_mouvement := (new.produit_id is null and coalesce(new.quantite_recue, 0) > 0);
  else
    new.recu_sans_mouvement := old.recu_sans_mouvement;
  end if;
  return new;
end;
$$;

revoke all on function public.marquer_reception_sans_mouvement() from public, anon, authenticated;

create trigger trg_expeditions_produits_sans_mouvement
  before insert or update on public.expeditions_produits
  for each row execute function public.marquer_reception_sans_mouvement();


-- §4 — Les clés ----------------------------------------------------------------
-- Le NOT NULL d'abord : sans ça, le SET NULL échouerait au moment de la
-- suppression. Une nouvelle ligne sans produit reste refusée par le §3.
alter table public.expeditions_produits alter column produit_id drop not null;

-- Supprimer puis recréer dans la même transaction : à aucun moment la table
-- n'est sans clé. Les lignes existantes sont toutes valides (la clé existait).
alter table public.mouvements_stock drop constraint if exists mouvements_stock_produit_id_fkey;
alter table public.mouvements_stock add  constraint mouvements_stock_produit_id_fkey
  foreign key (produit_id) references public.produits(id) on delete set null;

alter table public.expeditions_produits drop constraint if exists expeditions_produits_produit_id_fkey;
alter table public.expeditions_produits add  constraint expeditions_produits_produit_id_fkey
  foreign key (produit_id) references public.produits(id) on delete set null;

alter table public.stocks drop constraint if exists stocks_produit_id_fkey;
alter table public.stocks add  constraint stocks_produit_id_fkey
  foreign key (produit_id) references public.produits(id) on delete cascade;


-- §5 — La vérification ---------------------------------------------------------
-- LÈVE si une pièce manque. Puis une vraie suppression, dans un bloc qui finit
-- toujours par une exception : rien ne peut rester supprimé.
do $$
declare
  v_id      uuid;
  v_nom     text;
  v_mvts    int;
  v_lignes  int;
  v_erreur  text;
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_produits_suppression') then
    raise exception '§5 : trg_produits_suppression est toujours là.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('produit_suppression_garde', 'historique_produit', 'nom_produit_normalise')) then
    raise exception '§5 : une fonction du refus est toujours là.';
  end if;
  if (select confdeltype from pg_constraint where conname = 'mouvements_stock_produit_id_fkey'
        and conrelid = 'public.mouvements_stock'::regclass) is distinct from 'n' then
    raise exception '§5 : mouvements_stock_produit_id_fkey n''est pas en SET NULL.';
  end if;
  if (select confdeltype from pg_constraint where conname = 'expeditions_produits_produit_id_fkey'
        and conrelid = 'public.expeditions_produits'::regclass) is distinct from 'n' then
    raise exception '§5 : expeditions_produits_produit_id_fkey n''est pas en SET NULL.';
  end if;
  if (select confdeltype from pg_constraint where conname = 'stocks_produit_id_fkey'
        and conrelid = 'public.stocks'::regclass) is distinct from 'c' then
    raise exception '§5 : stocks_produit_id_fkey n''est pas en CASCADE.';
  end if;
  if exists (select 1 from pg_constraint where contype = 'f'
              and confrelid = 'public.produits'::regclass and confdeltype = 'r') then
    raise exception '§5 : il reste une clé en RESTRICT vers produits.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_expeditions_produits_sans_mouvement') then
    raise exception '§5 : le trigger trg_expeditions_produits_sans_mouvement est absent.';
  end if;
  if exists (select 1 from public.mouvements_stock where produit_id is not null and produit_nom is null)
     or exists (select 1 from public.expeditions_produits where produit_id is not null and produit_nom is null) then
    raise exception '§5 : des lignes existantes n''ont pas reçu leur nom.';
  end if;

  -- Une nouvelle ligne sans produit : refusée.
  begin
    insert into public.mouvements_stock (tenant_id, produit_id, entrepot_id, type_mouvement, quantite)
    select t.id, null::uuid, null::uuid, 'entree', 1 from public.tenants t limit 1;
    raise exception 'INSERTION_PASSEE';
  exception when others then
    v_erreur := sqlerrm;
  end;
  if v_erreur is distinct from 'Un mouvement de stock doit nommer son produit.' then
    raise exception '§5 : un mouvement sans produit n''est pas refusé comme prévu : %', v_erreur;
  end if;

  -- Le produit qui a le plus d'historique : on le supprime, on regarde, on annule.
  select p.id, p.product into v_id, v_nom
    from public.produits p
   order by (select count(*) from public.mouvements_stock m where m.produit_id = p.id)
          + (select count(*) from public.expeditions_produits ep where ep.produit_id = p.id) desc
   limit 1;
  if v_id is null then
    raise notice '§5 : aucun produit, tentative de suppression impossible.';
    return;
  end if;

  select count(*) into v_mvts   from public.mouvements_stock     where produit_id = v_id;
  select count(*) into v_lignes from public.expeditions_produits where produit_id = v_id;
  v_erreur := null;
  begin
    delete from public.produits where id = v_id;
    if exists (select 1 from public.stocks where produit_id = v_id) then
      raise exception 'ÉCHEC : des lignes de stock restent sans produit';
    end if;
    if (select count(*) from public.mouvements_stock
         where produit_id is null and produit_nom = v_nom) < v_mvts then
      raise exception 'ÉCHEC : des mouvements ont disparu ou perdu leur nom';
    end if;
    if (select count(*) from public.expeditions_produits
         where produit_id is null and produit_nom = v_nom) < v_lignes then
      raise exception 'ÉCHEC : des lignes d''expédition ont disparu ou perdu leur nom';
    end if;
    raise exception 'VERIFICATION_OK';
  exception when others then
    v_erreur := sqlerrm;
  end;
  if v_erreur <> 'VERIFICATION_OK' then
    raise exception '§5 : suppression de « % » : %', v_nom, v_erreur;
  end if;
  raise notice '§5 : « % » supprimé puis restauré — % mouvement(s) et % ligne(s) d''expédition gardés avec leur nom.',
    v_nom, v_mvts, v_lignes;
end $$;


-- §6 — Ce qu'une suppression emporterait aujourd'hui (lecture seule) -----------
-- Les lignes de stock NON NULLES : ce sont elles que le CASCADE efface.
select left(s.tenant_id::text, 8) as entreprise, p.product, e.nom as entrepot,
       s.quantite_disponible, s.quantite_reservee, s.quantite_defectueuse
  from public.stocks s
  join public.produits p on p.id = s.produit_id
  left join public.entrepots e on e.id = s.entrepot_id
 where coalesce(s.quantite_disponible, 0) <> 0
    or coalesce(s.quantite_reservee, 0) <> 0
    or coalesce(s.quantite_defectueuse, 0) <> 0
 order by 1, 2;
