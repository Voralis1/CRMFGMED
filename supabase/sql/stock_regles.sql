-- =============================================================================
-- RÈGLES DE STOCK : RUPTURE, PRODUIT NON RECONNU, LIBÉRATION AUTOMATIQUE — 05/11/2026
-- NE MODIFIE AUCUNE COMMANDE EXISTANTE. Ajoute 2 statuts, des règles, une répétition.
-- =============================================================================
--
-- SA DÉCISION (04–05/11). Le stock ne doit plus jamais partir en négatif
-- (le −1 du 03/11 : une commande confirmée et livrée alors que le stock était 0).
--
--   À L'ARRIVÉE d'un lead (statut « Pending ») :
--     · son produit n'est pas reconnu      → statut « Produit non reconnu » ;
--     · le DISPONIBLE ne suffit pas         → statut « Rupture de stock ».
--   À LA CONFIRMATION (tout statut qui envoie au livreur) :
--     · produit non reconnu                 → « Produit non reconnu » au lieu de confirmé ;
--     · DISPONIBLE insuffisant              → « Rupture de stock » au lieu de confirmé.
--     La ligne de stock est VERROUILLÉE : deux agents ne prennent pas la
--     dernière unité à la même seconde.
--   LE DISPONIBLE = le stock de l'entrepôt de la commande
--     − ce qui est déjà confirmé et pas encore pris par un livreur
--       (commande confirmée, stock_ajuste vide, livraison ni annulée ni en retour).
--   LE STOCK lui-même bouge à « expédiée » / « livrée » directe, revient au
--   retour (stock_livraison_autre_vendeur.sql, 05/11) ; « expédiée » sans
--   stock est refusée là-bas.
--   LIBÉRATION AUTOMATIQUE (personne ne clique) :
--     · le stock remonte (entrée, réception, ajustement, retour) ou une
--       commande confirmée est annulée / remise en attente / sa livraison
--       annulée avant d'être prise → les « Rupture de stock » de ce produit
--       dans cet entrepôt repassent « Pending », les plus anciennes d'abord,
--       AUTANT QUE LE STOCK LE PERMET (en comptant les leads qui attendent déjà
--       un appel pour ce produit) ;
--     · le produit d'une commande « Produit non reconnu » est relié (produit
--       créé puis remplir_produits_commandes, correspondance SKU ajoutée…)
--       → « Pending » si le disponible suffit, sinon « Rupture de stock ».
--
-- LES 2 STATUTS (code « rupture » / « produit_inconnu ») METTENT LE LEAD EN
-- PAUSE : ferme_le_lead = vrai, n'envoient pas au livreur. Donc : jamais
-- comptés comme tentative d'appel, montrés sous leur vrai nom (pas « En
-- attente »). Le Centre d'appel les montre quand même à l'agent (page).
-- Créés dans chaque entreprise, et dans chaque nouvelle entreprise.
--
-- Les règles se lisent sur le TEXTE des statuts (« Rupture de stock »,
-- « Produit non reconnu ») et sur le drapeau declenche_assignation.
--
-- PRÉREQUIS (vérifiés en §1, sinon rien n'est installé) :
--   · renvoyer_en_attente.sql du 05/11 relancé (la libération vers Pending) ;
--   · stock_livraison_autre_vendeur.sql du 05/11 relancé (stock à « expédiée »).
--
--   §1 prérequis ; §2 les 2 statuts ; §3 le disponible ; §4 arrivée et
--   confirmation ; §5 libération ; §6 droits ; §7 répétition (annulée) dans
--   l'entreprise de test : stock 1, deux confirmations, une arrivée, une
--   expédition, un retour, un produit inconnu — tout vérifié, puis annulé.
--
-- RETOUR ARRIÈRE : stock_regles_retour.sql (copie sur le Bureau), PUIS
-- stock_livraison_autre_vendeur_retour_04_11.sql si on veut aussi le stock à « livrée ».
-- =============================================================================

begin;

-- §1 Prérequis ---------------------------------------------------------------------
do $$
begin
  if coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.statut_pending_commande()')), '')
       not ilike '%crm.liberation_rupture%' then
    raise exception 'stock_regles.sql : relancez d''abord renvoyer_en_attente.sql (version du 05/11). Rien n''est installé.';
  end if;
  if position('Rupture : % disponible(s)' in coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.fn_ajuster_stock_livraison()')), '')) = 0 then
    raise exception 'stock_regles.sql : relancez d''abord stock_livraison_autre_vendeur.sql (version du 05/11 : stock à « expédiée »). Rien n''est installé.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'commandes' and column_name = 'produit_id') then
    raise exception 'stock_regles.sql : commandes.produit_id absent. Rien n''est installé.';
  end if;
end $$;

-- §2 Les 2 statuts ------------------------------------------------------------------
create or replace function public.semer_statuts_stock(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.statuts (nom, code, couleur, type, pays_id, tenant_id,
                              declenche_assignation, necessite_rappel, ferme_le_lead)
  select l.nom, l.code, l.couleur, 'appel', null, p_tenant, false, false, true
    from (values ('Rupture de stock', 'rupture', '#A35139'),
                 ('Produit non reconnu', 'produit_inconnu', '#8a5a1f')) l(nom, code, couleur)
   where not exists (select 1 from public.statuts s
                      where s.tenant_id = p_tenant and s.pays_id is null
                        and (s.code = l.code or lower(btrim(s.nom)) = lower(l.nom)));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.semer_statuts_stock(uuid) from public, anon, authenticated;
comment on function public.semer_statuts_stock(uuid) is 'fichier: stock_regles.sql';

create or replace function public.tenants_semer_statuts_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.semer_statuts_stock(new.id);
  return new;
end;
$$;
revoke all on function public.tenants_semer_statuts_stock() from public, anon, authenticated;
drop trigger if exists trg_tenants_semer_statuts_stock on public.tenants;
create trigger trg_tenants_semer_statuts_stock
  after insert on public.tenants
  for each row execute function public.tenants_semer_statuts_stock();

do $$
declare r record; n integer := 0;
begin
  for r in select id from public.tenants loop
    n := n + public.semer_statuts_stock(r.id);
  end loop;
  raise notice 'stock_regles.sql : % statut(s) ajouté(s) (« Rupture de stock », « Produit non reconnu » par entreprise).', n;
end $$;

-- §3 Le disponible ---------------------------------------------------------------------
-- Stock de l'entrepôt − ce qui est confirmé et pas encore pris. p_exclure : la
-- commande qu'on est en train de confirmer (elle ne se réserve pas elle-même).
create or replace function public.stock_disponible(p_tenant uuid, p_produit uuid, p_entrepot uuid, p_exclure uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.quantite_disponible from public.stocks s
                    where s.produit_id = p_produit and s.entrepot_id = p_entrepot), 0)
       - coalesce((select sum(coalesce(c.quantite, 1)) from public.commandes c
                    where c.tenant_id = p_tenant and c.produit_id = p_produit and c.entrepot_id = p_entrepot
                      and c.id is distinct from p_exclure
                      and c.stock_ajuste is null
                      and c.statut_confirmation in (select st.nom from public.statuts st
                                                     where st.tenant_id = p_tenant and st.declenche_assignation)
                      and not exists (select 1 from public.livraisons l
                                       where l.commande_id = c.id and l.statut in ('annule', 'retour'))), 0)::integer;
$$;
revoke all on function public.stock_disponible(uuid, uuid, uuid, uuid) from public, anon, authenticated;
comment on function public.stock_disponible(uuid, uuid, uuid, uuid) is 'fichier: stock_regles.sql';

-- §4 À l'arrivée et à la confirmation ---------------------------------------------------
-- « zzz » : après tous les triggers BEFORE qui posent produit_id (zz_produit_commande,
-- zz_produit_sku), l'entrepôt (zz_entrepot_commande) et Pending (aa_statut_pending).
create or replace function public.commande_statut_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirme boolean;
  v_avant    boolean := false;
begin
  -- À l'arrivée : un lead « Pending »
  if tg_op = 'INSERT' and new.statut_confirmation = 'Pending' then
    if new.produit_id is null then
      new.statut_confirmation := 'Produit non reconnu';
    elsif new.entrepot_id is null
       or public.stock_disponible(new.tenant_id, new.produit_id, new.entrepot_id, null) < coalesce(new.quantite, 1) then
      new.statut_confirmation := 'Rupture de stock';
    end if;
    return new;
  end if;

  -- À la confirmation : un statut qui envoie au livreur, qu'elle n'avait pas
  select exists (select 1 from public.statuts s
                  where s.tenant_id = new.tenant_id and s.nom = new.statut_confirmation and s.declenche_assignation)
    into v_confirme;
  if not v_confirme then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    select exists (select 1 from public.statuts s
                    where s.tenant_id = old.tenant_id and s.nom = old.statut_confirmation and s.declenche_assignation)
      into v_avant;
    if v_avant then
      return new;   -- déjà confirmée : rien à vérifier
    end if;
  end if;

  if new.produit_id is null then
    new.statut_confirmation := 'Produit non reconnu';
    return new;
  end if;
  if new.entrepot_id is null then
    new.statut_confirmation := 'Rupture de stock';
    return new;
  end if;
  -- Le verrou : la ligne de stock de ce produit dans cet entrepôt.
  perform 1 from public.stocks s where s.produit_id = new.produit_id and s.entrepot_id = new.entrepot_id for update;
  if public.stock_disponible(new.tenant_id, new.produit_id, new.entrepot_id, new.id) < coalesce(new.quantite, 1) then
    new.statut_confirmation := 'Rupture de stock';
  end if;
  return new;
end;
$$;
revoke all on function public.commande_statut_stock() from public, anon, authenticated;
comment on function public.commande_statut_stock() is 'fichier: stock_regles.sql';

drop trigger if exists trg_zzz_statut_stock on public.commandes;
create trigger trg_zzz_statut_stock
  before insert or update of statut_confirmation on public.commandes
  for each row execute function public.commande_statut_stock();

-- §5 La libération --------------------------------------------------------------------------
-- Les « Rupture de stock » d'un produit dans un entrepôt, les plus anciennes
-- d'abord, repassent Pending AUTANT QUE LE STOCK LE PERMET. Le budget =
-- le disponible − ce qui attend DÉJÀ un appel (Pending et autres statuts
-- ouverts) pour ce produit : un lead remis en attente n'est pas encore
-- confirmé, il ne « prend » rien au disponible — sans ce décompte, une seule
-- unité revenue libérait TOUTES les ruptures (trouvé par la répétition).
-- Une commande trop grosse pour le budget est sautée, la suivante essayée.
-- Renvoie le nombre libéré.
create or replace function public.liberer_ruptures(p_tenant uuid, p_produit uuid, p_entrepot uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; n integer := 0; v_budget integer;
begin
  if p_produit is null or p_entrepot is null then
    return 0;
  end if;
  perform 1 from public.stocks s where s.produit_id = p_produit and s.entrepot_id = p_entrepot for update;
  v_budget := public.stock_disponible(p_tenant, p_produit, p_entrepot, null)
            - coalesce((select sum(coalesce(c.quantite, 1)) from public.commandes c
                         where c.tenant_id = p_tenant and c.produit_id = p_produit and c.entrepot_id = p_entrepot
                           and (c.statut_confirmation = 'Pending'
                                or c.statut_confirmation in (select st.nom from public.statuts st
                                                              where st.tenant_id = p_tenant and not st.ferme_le_lead))), 0);
  for r in select c.id, coalesce(c.quantite, 1) as q
             from public.commandes c
            where c.tenant_id = p_tenant and c.produit_id = p_produit and c.entrepot_id = p_entrepot
              and c.statut_confirmation = 'Rupture de stock'
            -- les plus anciennes d'abord ; à égalité (même seconde), le n° de suivi, qui croît toujours
            order by coalesce(c.entree_file, c.created_at), c.tracking_number nulls last, c.id
            for update loop
    exit when v_budget <= 0;
    if r.q <= v_budget then
      perform set_config('crm.liberation_rupture', 'oui', true);
      update public.commandes set statut_confirmation = 'Pending' where id = r.id;
      perform set_config('crm.liberation_rupture', '', true);
      v_budget := v_budget - r.q;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.liberer_ruptures(uuid, uuid, uuid) from public, anon, authenticated;
comment on function public.liberer_ruptures(uuid, uuid, uuid) is 'fichier: stock_regles.sql';

-- Le stock remonte : entrée, réception, ajustement, retour.
create or replace function public.mouvement_liberer_ruptures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type_mouvement in ('entree', 'retour_ok', 'ajustement') then
    perform public.liberer_ruptures(new.tenant_id, new.produit_id, new.entrepot_id);
  end if;
  return new;
end;
$$;
revoke all on function public.mouvement_liberer_ruptures() from public, anon, authenticated;
drop trigger if exists trg_zz_mouvement_liberer_ruptures on public.mouvements_stock;
create trigger trg_zz_mouvement_liberer_ruptures
  after insert on public.mouvements_stock
  for each row execute function public.mouvement_liberer_ruptures();

-- Une commande : confirmée puis plus confirmée (avant d'être prise) → libère son produit ;
-- « Produit non reconnu » dont le produit vient d'être relié → Pending ou Rupture.
create or replace function public.commande_liberer_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_etait boolean; v_est boolean;
begin
  if new.statut_confirmation is distinct from old.statut_confirmation and new.stock_ajuste is null then
    select exists (select 1 from public.statuts s where s.tenant_id = old.tenant_id and s.nom = old.statut_confirmation and s.declenche_assignation),
           exists (select 1 from public.statuts s where s.tenant_id = new.tenant_id and s.nom = new.statut_confirmation and s.declenche_assignation)
      into v_etait, v_est;
    if v_etait and not v_est then
      perform public.liberer_ruptures(new.tenant_id, new.produit_id, new.entrepot_id);
    end if;
  end if;

  if new.statut_confirmation = 'Produit non reconnu' and old.produit_id is null and new.produit_id is not null then
    perform set_config('crm.liberation_rupture', 'oui', true);
    update public.commandes
       set statut_confirmation = case
             when new.entrepot_id is not null
              and public.stock_disponible(new.tenant_id, new.produit_id, new.entrepot_id, null) >= coalesce(new.quantite, 1)
             then 'Pending' else 'Rupture de stock' end
     where id = new.id;
    perform set_config('crm.liberation_rupture', '', true);
  end if;
  return new;
end;
$$;
revoke all on function public.commande_liberer_stock() from public, anon, authenticated;
drop trigger if exists trg_zzz_commande_liberer_stock on public.commandes;
create trigger trg_zzz_commande_liberer_stock
  after update of statut_confirmation, produit_id on public.commandes
  for each row execute function public.commande_liberer_stock();

-- Une livraison annulée ou en retour AVANT d'être prise : la réservation part.
-- (Prise puis revenue : le mouvement « retour_ok » libère déjà, via le trigger du stock.)
create or replace function public.livraison_liberer_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cmd record;
begin
  if new.statut in ('annule', 'retour') and old.statut is distinct from new.statut then
    select c.tenant_id, c.produit_id, c.entrepot_id, c.stock_ajuste into v_cmd
      from public.commandes c where c.id = new.commande_id;
    if found and v_cmd.stock_ajuste is null then
      perform public.liberer_ruptures(v_cmd.tenant_id, v_cmd.produit_id, v_cmd.entrepot_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.livraison_liberer_stock() from public, anon, authenticated;
drop trigger if exists trg_zzz_livraison_liberer_stock on public.livraisons;
create trigger trg_zzz_livraison_liberer_stock
  after update of statut on public.livraisons
  for each row execute function public.livraison_liberer_stock();

-- §6 Droits : vérification ---------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.stock_disponible(uuid,uuid,uuid,uuid)', 'public.liberer_ruptures(uuid,uuid,uuid)',
                           'public.semer_statuts_stock(uuid)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'stock_regles.sql : % est appelable par un compte de l''application. Rien n''est installé.', f;
    end if;
  end loop;
end $$;

-- §7 Répétition (annulée) --------------------------------------------------------------------
do $$
declare
  v_t uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_pays uuid; v_ent uuid; v_prod uuid; v_liv uuid; v_lv uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  if not exists (select 1 from public.tenants where id = v_t) then
    select p.tenant_id into v_t from public.pays p
     join public.entrepots e on e.pays_id = p.id order by p.tenant_id limit 1;
  end if;
  select e.pays_id, e.id into v_pays, v_ent from public.entrepots e where e.tenant_id = v_t and e.pays_id is not null order by e.nom limit 1;
  select id into v_liv from public.livreurs where tenant_id = v_t order by id limit 1;
  if v_ent is null or v_liv is null then
    raise notice 'stock_regles.sql : répétition sautée (pas d''entrepôt ou de livreur dans l''entreprise de test). Règles installées.';
    return;
  end if;

  begin
    v_etape := 'préparation : un produit avec 1 en stock';
    insert into public.produits (tenant_id, product, code, price)
    values (v_t, 'Répétition stock', 'repetition-stock-' || left(gen_random_uuid()::text, 8), 1)
    returning id into v_prod;
    insert into public.mouvements_stock (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
    values (v_t, v_prod, v_ent, 'entree', 1, 'répétition');

    v_etape := 'deux leads arrivent : En attente';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, adresse, entrepot_id)
    values (v_t, 'REPETITION-STOCK-1-' || gen_random_uuid(), 'R', '+000', (select code from public.produits where id = v_prod), 1, 0, v_pays, 'Nulle part', 'rue', v_ent)
    returning id into c1;
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, adresse, entrepot_id)
    values (v_t, 'REPETITION-STOCK-2-' || gen_random_uuid(), 'R', '+000', (select code from public.produits where id = v_prod), 1, 0, v_pays, 'Nulle part', 'rue', v_ent)
    returning id into c2;
    if (select count(*) from public.commandes where id in (c1, c2) and statut_confirmation = 'Pending') <> 2 then
      raise exception 'les deux leads ne sont pas « Pending » (stock 1)';
    end if;

    v_etape := 'confirmer le 1er : Confirmé';
    update public.commandes set statut_confirmation = 'Confirmed' where id = c1;
    if (select statut_confirmation from public.commandes where id = c1) <> 'Confirmed' then
      raise exception 'le 1er lead n''est pas confirmé';
    end if;

    v_etape := 'confirmer le 2e : Rupture de stock (la dernière unité est déjà réservée)';
    update public.commandes set statut_confirmation = 'Confirmed' where id = c2;
    if (select statut_confirmation from public.commandes where id = c2) <> 'Rupture de stock' then
      raise exception 'le 2e lead n''est pas passé en rupture (lu : %)', (select statut_confirmation from public.commandes where id = c2);
    end if;

    v_etape := 'un 3e lead arrive : Rupture de stock';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, adresse, entrepot_id)
    values (v_t, 'REPETITION-STOCK-3-' || gen_random_uuid(), 'R', '+000', (select code from public.produits where id = v_prod), 1, 0, v_pays, 'Nulle part', 'rue', v_ent)
    returning id into c3;
    if (select statut_confirmation from public.commandes where id = c3) <> 'Rupture de stock' then
      raise exception 'le 3e lead n''est pas arrivé en rupture';
    end if;

    v_etape := 'un lead au produit inconnu arrive : Produit non reconnu';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, adresse, entrepot_id)
    values (v_t, 'REPETITION-STOCK-4-' || gen_random_uuid(), 'R', '+000', 'produit-qui-n-existe-pas-' || gen_random_uuid(), 1, 0, v_pays, 'Nulle part', 'rue', v_ent)
    returning id into c4;
    if (select statut_confirmation from public.commandes where id = c4) <> 'Produit non reconnu' then
      raise exception 'le lead au produit inconnu n''est pas « Produit non reconnu »';
    end if;

    v_etape := '« expédiée » : le stock passe de 1 à 0';
    select id into v_lv from public.livraisons where commande_id = c1 order by created_at limit 1;
    if v_lv is null then
      insert into public.livraisons (tenant_id, commande_id, livreur_id, statut) values (v_t, c1, v_liv, 'a_preparer') returning id into v_lv;
    end if;
    update public.livraisons set statut = 'expedie' where id = v_lv;
    if (select quantite_disponible from public.stocks where produit_id = v_prod and entrepot_id = v_ent) <> 0 then
      raise exception 'le stock n''est pas à 0 après « expédiée »';
    end if;

    v_etape := '« retour » : le stock revient à 1, le plus ancien en rupture repasse En attente (un seul)';
    update public.livraisons set statut = 'retour' where id = v_lv;
    if (select quantite_disponible from public.stocks where produit_id = v_prod and entrepot_id = v_ent) <> 1 then
      raise exception 'le stock n''est pas revenu à 1';
    end if;
    if (select statut_confirmation from public.commandes where id = c2) <> 'Pending'
       or (select statut_confirmation from public.commandes where id = c3) <> 'Rupture de stock' then
      raise exception 'libération : attendu le 2e en attente, le 3e encore en rupture (lus : % / %)',
        (select statut_confirmation from public.commandes where id = c2), (select statut_confirmation from public.commandes where id = c3);
    end if;

    v_etape := '« expédiée » sans stock : refusée';
    -- le 2e est confirmé (1 en stock), puis on retire l'unité à la main : « expédiée » doit être refusée
    update public.commandes set statut_confirmation = 'Confirmed' where id = c2;
    insert into public.livraisons (tenant_id, commande_id, livreur_id, statut)
    select v_t, c2, v_liv, 'a_preparer' where not exists (select 1 from public.livraisons where commande_id = c2);
    insert into public.mouvements_stock (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
    values (v_t, v_prod, v_ent, 'sortie', 1, 'répétition : perte');
    v_refus := false;
    begin
      update public.livraisons set statut = 'expedie' where commande_id = c2;
    exception when others then v_refus := sqlerrm like 'Rupture :%';
    end;
    if not v_refus then raise exception '« expédiée » acceptée sans stock'; end if;
    if exists (select 1 from public.stocks where produit_id = v_prod and entrepot_id = v_ent and quantite_disponible < 0) then
      raise exception 'le stock est passé en négatif';
    end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'stock_regles.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'stock_regles.sql : rupture à l''arrivée et à la confirmation, produit non reconnu, libération automatique, expédition sans stock refusée (répétition annulée).';
end $$;

commit;

select s.tenant_id, s.nom, s.code, s.ferme_le_lead from public.statuts s
 where s.code in ('rupture', 'produit_inconnu') order by s.tenant_id, s.code;
