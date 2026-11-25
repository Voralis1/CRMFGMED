-- =============================================================================
-- FERMER LES PORTES DU STOCK — 11/11/2026 (T22, étape B du plan stock du 04/11)
-- NE MODIFIE AUCUNE DONNÉE. Ajoute 3 gardes (triggers) et 1 contrôle.
-- =============================================================================
--
-- LU EN PROD LE 11/11 : les règles `mouvements_ecriture` / `stocks_ecriture`
-- laissent un manager / admin TOUT écrire, et rien ne vérifie :
--   1. une « Sortie » tapée dans Paramètres → Mouvements n'est jamais comparée
--      au stock : Sortie 5 sur un stock de 2 → stock −3 ;
--      une « Entrée » de −5 baisse aussi le stock (aucune règle quantité > 0) ;
--   2. un mouvement passé se modifie ou se supprime — le stock ne suit pas,
--      l'historique ment ;
--   3. le chiffre du stock se tape directement, sans mouvement ni trace ;
--      l'écran Produits efface une ligne de stock « vide » — une ligne
--      NÉGATIVE compte comme vide : le −3 disparaît sans trace ;
--   4. supprimer un entrepôt efface tous ses mouvements et son stock.
--
-- LA RÈGLE (seulement ce qui vient DIRECTEMENT du navigateur) :
--   « direct » = la requête s'exécute sous le rôle `authenticated` (ou anon) et
--   n'est pas lancée par un autre trigger (pg_trigger_depth() = 1). Le travail
--   du système passe comme avant : la réception (receptionner_expedition), la
--   livraison (fn_ajuster_stock_livraison), la correction de quantité reçue,
--   le nettoyage — fonctions SECURITY DEFINER, elles tournent sous leur
--   propriétaire — et la mise à jour automatique du stock après un mouvement
--   (actualiser_stock_apres_mouvement, un trigger : profondeur 2). L'éditeur
--   SQL et le service role passent aussi.
--   §1 mouvement saisi à la main : quantité > 0 ; une Sortie ne prend pas plus
--      que le DISPONIBLE (stock − unités promises aux commandes confirmées,
--      stock_disponible, la même règle que la confirmation) : « Sortie refusée :
--      2 disponible(s) de product-b dans l'entrepôt Angola ».
--      Un mouvement ne se modifie ni ne se supprime : on corrige par le
--      mouvement inverse, avec une note.
--   §2 stock : une ligne se crée à 0 (l'écran Produits), se supprime seulement
--      si elle est à 0 ; ses quantités ne se tapent pas.
--   §3 entrepôt : avec des mouvements, il ne se supprime pas (le rendre inactif).
-- Tous les comptes de l'application (super admin compris) : un stock faux l'est
-- quel que soit le rôle.
--
-- RETOUR ARRIÈRE : stock_portes_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.stock_disponible(uuid, uuid, uuid, uuid)') is null then
    raise exception 'stock_portes.sql : lancez d''abord stock_regles.sql (stock_disponible). Rien n''est installé.';
  end if;
end $$;

-- Ce qui vient directement du navigateur (pas du système). Volontairement PAS
-- security definer : current_user doit être celui qui écrit.
create or replace function public.ecriture_directe_navigateur()
returns boolean
language sql
stable
set search_path = public
as $$
  select current_user in ('authenticated', 'anon') and pg_trigger_depth() <= 1;
$$;
revoke all on function public.ecriture_directe_navigateur() from public, anon;
grant execute on function public.ecriture_directe_navigateur() to authenticated;
comment on function public.ecriture_directe_navigateur() is 'fichier: stock_portes.sql';

-- Le contrôle d'une Sortie (security definer : stock_disponible est fermé aux
-- comptes). Vérifie l'entreprise de l'appelant, verrouille la ligne de stock.
create or replace function public.verifier_sortie_stock(p_tenant uuid, p_produit uuid, p_entrepot uuid, p_quantite numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_dispo numeric; v_prod text; v_ent text;
begin
  if not (public.is_super_admin() or p_tenant = public.get_my_tenant_id()) then
    raise exception 'Ce stock n''est pas de votre entreprise.' using errcode = '42501';
  end if;
  perform 1 from public.stocks s where s.produit_id = p_produit and s.entrepot_id = p_entrepot for update;
  v_dispo := public.stock_disponible(p_tenant, p_produit, p_entrepot, null);
  if p_quantite > v_dispo then
    select coalesce(nullif(btrim(p.code), ''), p.product) into v_prod from public.produits p where p.id = p_produit;
    select e.nom into v_ent from public.entrepots e where e.id = p_entrepot;
    raise exception 'Sortie refusée : % disponible(s) de % dans l''entrepôt % (les unités promises aux commandes confirmées ne sortent pas).',
      greatest(v_dispo, 0), coalesce(v_prod, '?'), coalesce(v_ent, '?')
      using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function public.verifier_sortie_stock(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.verifier_sortie_stock(uuid, uuid, uuid, numeric) to authenticated;
comment on function public.verifier_sortie_stock(uuid, uuid, uuid, numeric) is 'fichier: stock_portes.sql';

-- §1 Les mouvements ------------------------------------------------------------------
create or replace function public.mouvement_stock_garde()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.ecriture_directe_navigateur() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.quantite is null or new.quantite <= 0 then
      raise exception 'La quantité d''un mouvement de stock doit être plus grande que 0.' using errcode = 'check_violation';
    end if;
    if new.type_mouvement = 'sortie' then
      perform public.verifier_sortie_stock(new.tenant_id, new.produit_id, new.entrepot_id, new.quantite);
    end if;
    return new;
  end if;
  raise exception 'Un mouvement de stock est l''historique : il ne se modifie pas et ne se supprime pas. Corrigez par le mouvement inverse (Entrée ou Sortie), avec une note.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.mouvement_stock_garde() from public, anon, authenticated;
comment on function public.mouvement_stock_garde() is 'fichier: stock_portes.sql';

drop trigger if exists trg_aa_mouvement_stock_garde on public.mouvements_stock;
create trigger trg_aa_mouvement_stock_garde
  before insert or update or delete on public.mouvements_stock
  for each row execute function public.mouvement_stock_garde();

-- §2 Les lignes de stock ----------------------------------------------------------------
create or replace function public.stock_ligne_garde()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.ecriture_directe_navigateur() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.quantite_disponible, 0) <> 0 or coalesce(new.quantite_reservee, 0) <> 0
       or coalesce(new.quantite_defectueuse, 0) <> 0 then
      raise exception 'Une ligne de stock se crée à 0 : le stock entre par un mouvement (Entrée, ou réception d''une expédition).'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.quantite_disponible is distinct from old.quantite_disponible
       or new.quantite_reservee is distinct from old.quantite_reservee
       or new.quantite_defectueuse is distinct from old.quantite_defectueuse
       or new.produit_id is distinct from old.produit_id
       or new.entrepot_id is distinct from old.entrepot_id
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Le stock ne se tape pas : il change par un mouvement (Paramètres → Mouvements de stock).'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- DELETE
  if coalesce(old.quantite_disponible, 0) <> 0 or coalesce(old.quantite_defectueuse, 0) <> 0
     or coalesce(old.quantite_reservee, 0) <> 0 then
    raise exception 'Cette ligne de stock n''est pas à 0 (disponible %, défectueux %) : elle ne se supprime pas. Ramenez-la à 0 par un mouvement d''abord.',
      coalesce(old.quantite_disponible, 0), coalesce(old.quantite_defectueuse, 0)
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke all on function public.stock_ligne_garde() from public, anon, authenticated;
comment on function public.stock_ligne_garde() is 'fichier: stock_portes.sql';

drop trigger if exists trg_aa_stock_ligne_garde on public.stocks;
create trigger trg_aa_stock_ligne_garde
  before insert or update or delete on public.stocks
  for each row execute function public.stock_ligne_garde();

-- §3 Les entrepôts ------------------------------------------------------------------------
create or replace function public.entrepot_suppression_garde()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.ecriture_directe_navigateur() then
    return old;
  end if;
  if exists (select 1 from public.mouvements_stock m where m.entrepot_id = old.id) then
    raise exception 'L''entrepôt « % » a des mouvements de stock (son historique) : il ne se supprime pas. Rendez-le inactif.', old.nom
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke all on function public.entrepot_suppression_garde() from public, anon, authenticated;
comment on function public.entrepot_suppression_garde() is 'fichier: stock_portes.sql';

drop trigger if exists trg_aa_entrepot_suppression_garde on public.entrepots;
create trigger trg_aa_entrepot_suppression_garde
  before delete on public.entrepots
  for each row execute function public.entrepot_suppression_garde();

-- §4 Vérification ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_trigger
       where tgname in ('trg_aa_mouvement_stock_garde', 'trg_aa_stock_ligne_garde', 'trg_aa_entrepot_suppression_garde')
         and tgenabled = 'O') <> 3 then
    raise exception 'stock_portes.sql : les 3 gardes ne sont pas actives. Rien n''est installé.';
  end if;
  if exists (select 1 from pg_proc where proname in ('mouvement_stock_garde', 'stock_ligne_garde', 'entrepot_suppression_garde', 'ecriture_directe_navigateur')
              and prosecdef) then
    raise exception 'stock_portes.sql : une garde tourne en propriétaire (security definer) — elle ne verrait plus qui écrit. Rien n''est installé.';
  end if;
  raise notice 'stock_portes.sql : Sortie contrôlée, mouvements = historique, stock seulement par mouvement, entrepôt avec historique gardé. Aucune donnée modifiée.';
end $$;

commit;
