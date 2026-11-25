-- =============================================================================
-- Intake générique — 16/10/2026
-- À exécuter AVANT de déployer import-commande : la fonction lit les colonnes
-- de signature et écrit commandes.articles. Déployée avant ce fichier, elle
-- refuserait TOUS les leads arrivant par jeton.
--
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
-- Rien ici ne réécrit une table : des colonnes nullables (ou à défaut
-- constant, sans réécriture depuis Postgres 11), une contrainte, un index sur
-- produits (13 lignes le 16/10). Le service n'est pas interrompu.
--
--   1. commandes.articles        les lignes de la commande, lues une fois
--   2. produits.code unique      par entreprise, pour trouver un produit par code
--   3. sources_import.signature_* la vérification de signature, par source
--
-- Pas de type 'woocommerce' dans sources_import.type : la signature est
-- décidée par la configuration de la source, pas par le nom d'une boutique.
-- Une source WooCommerce est une source 'webhook' avec un en-tête de
-- signature — comme une source Shopify, GitHub, ou une qui ne signe rien.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. commandes.articles — [{"produit","quantite","prix","code"}]
--
-- `produit` reste le texte joint ("Crème A ×2 + Sérum B ×1") : les écrans et
-- la recherche le lisent tel quel. `articles` garde les lignes dans UNE forme,
-- lue une seule fois par le code qui connaît la forme du payload. Sans elle,
-- reprendre le stock plus tard voudrait dire relire le JSON de chaque boutique
-- dans imports_bruts — un journal qui peut être purgé, et qui n'existe pas pour
-- une commande saisie à la main ou importée d'Excel.
--
-- `prix` d'un article = prix UNITAIRE tel que la source l'a écrit, null sinon.
-- Il n'est jamais calculé. null pour toutes les commandes d'avant ce fichier.
-- -----------------------------------------------------------------------------
alter table public.commandes add column if not exists articles jsonb;

alter table public.commandes drop constraint if exists commandes_articles_liste;
alter table public.commandes
  add constraint commandes_articles_liste
  check (articles is null or jsonb_typeof(articles) = 'array');

comment on column public.commandes.articles is
  'Lignes de la commande [{produit, quantite, prix (unitaire, tel qu''écrit), code}]. produit = texte joint.';


-- -----------------------------------------------------------------------------
-- 2. produits.code — unique PAR ENTREPRISE, nullable
--
-- La colonne existe déjà (12 produits sur 13 en ont un le 16/10, aucun
-- doublon). L'intake cherche un produit d'abord par code : il faut qu'un code
-- ne désigne qu'UN produit. Sans tenant_id dans l'index, deux entreprises ne
-- pourraient pas avoir le même code (leçon pays_nom_key, §6.11).
--
-- Comparé sans casse ni espaces autour, comme l'intake le compare. Un code
-- vide n'est pas un code.
--
-- On vérifie les doublons AVANT de toucher à l'index : s'il y en a, rien n'est
-- modifié et le message les nomme.
-- -----------------------------------------------------------------------------
-- GARDE (10/11) : l'unicité est par VENDEUR depuis produits_par_vendeur.sql
-- (T14). Un index déjà par vendeur est gardé tel quel — le refaire par
-- entreprise refuserait deux vendeurs au même code (avis « gardé »).
do $$
declare d text;
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_produits_code_unique'
              and indexdef ilike '%vendeur_id%') then
    raise notice 'intake_generique.sql : idx_produits_code_unique gardé (par vendeur, produits_par_vendeur.sql). Pas refait.';
    return;
  end if;
  select string_agg(format('%s → "%s" ×%s', tenant_id, c, n), '; ')
    into d
    from (select tenant_id, lower(btrim(code)) c, count(*) n
            from public.produits
           where code is not null and btrim(code) <> ''
           group by 1, 2 having count(*) > 1) x;
  if d is not null then
    raise exception 'Codes produit en double, à corriger avant l''index : %', d;
  end if;
  -- drop puis create : un `create unique index if not exists` garderait sans
  -- rien dire un index du même nom sur d'autres colonnes (§6.12).
  drop index if exists public.idx_produits_code_unique;
  create unique index idx_produits_code_unique
    on public.produits (tenant_id, lower(btrim(code)))
    where code is not null and btrim(code) <> '';
end $$;


-- -----------------------------------------------------------------------------
-- 3. La signature, par source
--
--   WooCommerce   x-wc-webhook-signature   sha256   base64
--   Shopify       x-shopify-hmac-sha256    sha256   base64
--   GitHub        x-hub-signature-256      sha256   hex     préfixe 'sha256='
--
-- Pas d'en-tête → pas de vérification : la source marche au jeton seul.
-- La signature est une défense en plus (règle du 20/10, voir plus bas).
--
-- LE SECRET EST RANGÉ LISIBLE, ici, dans sources_import.signature_secret. Ce
-- n'est pas un jeton : le jeton est haché parce qu'on ne fait que le comparer ;
-- le secret doit SERVIR à calculer le HMAC, il ne peut pas être haché.
-- Depuis le 20/10 (secret_signature_source.sql), personne ne le lit ni ne
-- l'écrit directement : il est tiré par la base, relu par
-- reveler_secret_source(), collé (Shopify) par definir_secret_source().
-- -----------------------------------------------------------------------------
alter table public.sources_import add column if not exists signature_entete   text;
alter table public.sources_import add column if not exists signature_algo     text not null default 'sha256';
alter table public.sources_import add column if not exists signature_encodage text not null default 'base64';
alter table public.sources_import add column if not exists signature_prefixe  text;
alter table public.sources_import add column if not exists signature_secret   text;

alter table public.sources_import drop constraint if exists sources_import_signature_algo_valide;
alter table public.sources_import
  add constraint sources_import_signature_algo_valide
  check (signature_algo in ('sha1', 'sha256', 'sha512'));

alter table public.sources_import drop constraint if exists sources_import_signature_encodage_valide;
alter table public.sources_import
  add constraint sources_import_signature_encodage_valide
  check (signature_encodage in ('base64', 'hex'));

-- Un nom d'en-tête HTTP, rien d'autre (la fonction le passe à Headers.get).
alter table public.sources_import drop constraint if exists sources_import_signature_entete_valide;
alter table public.sources_import
  add constraint sources_import_signature_entete_valide
  check (signature_entete is null or signature_entete ~ '^[A-Za-z0-9-]{1,100}$');

-- 20/10 : la règle s'est inversée (secret_signature_source.sql). Le secret
-- est tiré pour chaque source ; c'est l'EN-TÊTE qui allume la vérification,
-- et un en-tête exige un secret. Écrite ici à l'identique : rejouer ce
-- fichier avec l'ancienne règle échouerait sur chaque source qui a un secret
-- sans en-tête.
alter table public.sources_import drop constraint if exists sources_import_signature_complete;
alter table public.sources_import
  add constraint sources_import_signature_complete
  check ((signature_secret is null or length(signature_secret) >= 16)
         and (signature_entete is null or signature_secret is not null));

comment on column public.sources_import.signature_secret is
  'Secret HMAC. LISIBLE exprès (il sert à calculer, pas à comparer). Illisible pour authenticated : passer par reveler_secret_source(). Vérifié seulement si signature_entete est posé.';


-- -----------------------------------------------------------------------------
-- 4. Vérification (lecture seule)
-- -----------------------------------------------------------------------------
select 'commandes.articles' as quoi, count(*)::text as etat
  from information_schema.columns
 where table_schema = 'public' and table_name = 'commandes' and column_name = 'articles'
union all
select 'idx_produits_code_unique', indexdef
  from pg_indexes where schemaname = 'public' and indexname = 'idx_produits_code_unique'
union all
select 'sources_import.signature_*', count(*)::text
  from information_schema.columns
 where table_schema = 'public' and table_name = 'sources_import' and column_name like 'signature\_%';
