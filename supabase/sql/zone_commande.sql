-- =====================================================================
-- La zone d'une commande — 27/10/2026 — FICHIER 1 SUR 2
-- =====================================================================
--
-- LE PROBLÈME : un lead (API, import CSV, saisie manuelle) arrive avec une
-- ville en texte libre (ville_zone). Les zones sont des lignes configurées
-- (zones). Rien ne reliait les deux : la commande arrivait avec une ville et
-- sans zone_id. L'agent choisissait la zone à la main sur chaque lead, et
-- l'écran Livraisons ne trouvait pas de frais (« Aucune zone tarifaire »).
--
-- LA RÈGLE :
--
--   zone_id = la zone de l'entreprise, DANS LE PAYS DE LA COMMANDE, dont le
--   nom est égal à la ville, aux accents, à la casse et aux espaces près.
--   « luanda », « Luanda », « LUANDA », « Luanda  » → la zone « luanda ».
--
--   · aucune zone ne correspond, ou plusieurs : zone_id reste vide, la ville
--     reste telle quelle. L'agent choisit, comme avant.
--   · égalité, jamais « contient » : « Luanda Cazenga » ne donne pas la zone
--     « Luanda ». Une zone fausse coûte plus cher qu'une zone vide.
--   · UNE COMMANDE NE CRÉE JAMAIS DE ZONE. Une zone est de la configuration
--     (avec ses frais) : une faute de frappe dans un lead ne doit pas devenir
--     une ligne du barème.
--
-- QUAND :
--   · à la création (insert) si zone_id n'est pas fourni ;
--   · à la modification, seulement quand la ville (aux accents/espaces près)
--     ou le pays change ET que zone_id n'est pas écrit dans la même
--     modification — l'ancienne zone peut ne plus convenir ; le résultat peut
--     être vide ;
--   · JAMAIS quand zone_id vient d'être écrit, y compris vidé : l'agent qui
--     vide la zone le fait exprès, on ne la remet pas derrière lui ;
--   · jamais sur une commande déjà partie (commande_expediee) : sa zone est
--     un fait, comme son entrepôt.
--
-- UNE SEULE FONCTION pour tous les chemins : un trigger sur commandes couvre
-- l'API (clé service), l'import CSV et la saisie manuelle (navigateur),
-- l'éditeur SQL, et les chemins qui n'existent pas encore. Aucun
-- déploiement de fonction Edge, aucun changement de page.
--
-- La normalisation : texte_normalise() est défini dans entrepot_commande.sql
-- depuis le 29/10 (UNE définition, que produit_de_commande appelle aussi).
-- Ce fichier l'utilise et vérifie qu'il est là (§1).
--
-- CE FICHIER NE MODIFIE AUCUNE COMMANDE EXISTANTE. Le rattrapage est le
-- fichier 2 (zone_commande_2_rattrapage.sql), lancé séparément.
--
-- Exécutable en entier, et deux fois : create or replace partout.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. La normalisation d'un texte
-- ---------------------------------------------------------------------
-- Défini dans entrepot_commande.sql (29/10). Ici : seulement vérifier qu'il
-- est là, avant de s'en servir.
do $$
begin
  if to_regprocedure('public.texte_normalise(text)') is null then
    raise exception 'texte_normalise(text) absent : entrepot_commande.sql doit être en place. Rien n''a été installé.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 2. La zone d'une ville, dans un pays
-- ---------------------------------------------------------------------
-- SECURITY DEFINER : le vendeur ne lit pas la table zones (zones_select),
-- et c'est souvent lui qui crée la commande (import CSV). Sans ça, ses
-- commandes ne trouveraient jamais leur zone.
-- Fermée au navigateur : seuls les triggers et l'éditeur SQL l'appellent.
create or replace function public.zone_de_commande(p_tenant uuid, p_pays uuid, p_ville text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) = 1 then min(z.id::text)::uuid end
    from public.zones z
   where z.tenant_id = p_tenant
     and z.pays_id   = p_pays
     and public.texte_normalise(z.nom_zone) = public.texte_normalise(p_ville);
$$;

revoke all on function public.zone_de_commande(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Le trigger
-- ---------------------------------------------------------------------
create or replace function public.zone_commande_auto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.zone_id is null then
      new.zone_id := public.zone_de_commande(new.tenant_id, new.pays_id, new.ville_zone);
    end if;
    return new;
  end if;

  -- zone_id écrit dans cette modification (choisie, changée ou vidée) :
  -- c'est un choix, on n'y touche pas.
  if new.zone_id is distinct from old.zone_id then
    return new;
  end if;

  -- Ni la ville ni le pays n'ont changé : rien à recalculer.
  if public.texte_normalise(new.ville_zone) is not distinct from public.texte_normalise(old.ville_zone)
     and new.pays_id is not distinct from old.pays_id then
    return new;
  end if;

  -- Déjà partie : la zone est un fait.
  if public.commande_expediee(new.id) then
    return new;
  end if;

  new.zone_id := public.zone_de_commande(new.tenant_id, new.pays_id, new.ville_zone);
  return new;
end;
$$;

revoke all on function public.zone_commande_auto() from public, anon, authenticated;

-- Les triggers BEFORE passent dans l'ordre alphabétique de leur nom :
-- « trg_zz_zone » passe après trg_set_tenant_id_commandes (tenant_id
-- rempli), trg_zy_pays_commande (pays vérifié) et trg_zz_entrepot_commande.
-- Le trigger AFTER tr_auto_affecter_livreur voit donc déjà la zone.
-- « create or replace » : pas un instant sans trigger, la production tourne.
create or replace trigger trg_zz_zone_commande
  before insert or update of ville_zone, pays_id, zone_id on public.commandes
  for each row execute function public.zone_commande_auto();


-- ---------------------------------------------------------------------
-- 4. Vérification — lève une erreur si quelque chose manque
-- ---------------------------------------------------------------------
do $$
declare
  v_role text;
begin
  if to_regprocedure('public.commande_expediee(uuid)') is null then
    raise exception 'commande_expediee(uuid) absente : entrepot_commande.sql doit être en place.';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.commandes'::regclass
                    and tgname = 'trg_zz_zone_commande' and tgenabled <> 'D') then
    raise exception 'trg_zz_zone_commande absent ou désactivé.';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.zone_de_commande(uuid,uuid,text)', 'execute') then
      raise exception 'zone_de_commande est encore exécutable par %.', v_role;
    end if;
  end loop;
  if public.texte_normalise('  LUÀNDA   ') is distinct from 'luanda'
     or public.texte_normalise('   ') is not null then
    raise exception 'texte_normalise ne donne pas le résultat attendu.';
  end if;
  raise notice 'zone_commande.sql : en place. Aucune commande existante modifiée.';
end $$;
