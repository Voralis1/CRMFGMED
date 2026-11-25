-- #############################################################################
-- ##  RETIRÉ DU PRODUIT LE 20/10 — LA SIGNATURE N'EST PLUS UTILISÉE.           ##
-- ##                                                                           ##
-- ##  Ce fichier a été APPLIQUÉ en production le 20/10 ; ce qu'il a créé y     ##
-- ##  reste, en sommeil : colonnes signature_* (non lues), fonctions de        ##
-- ##  signature (plus appelées par l'écran), triggers. Aucun code de           ##
-- ##  l'application ni d'import-commande ne lit ni ne vérifie une signature.   ##
-- ##                                                                           ##
-- ##  NE PAS LE REJOUER. Gardé sur disque pour mémoire (travail mis de côté,   ##
-- ##  pas supprimé). La lecture colonne par colonne de sources_import est      ##
-- ##  maintenue par identifiants_api.sql (CLAUDE.md §6.16).                    ##
-- #############################################################################
-- #############################################################################
-- ##  À EXÉCUTER APRÈS LE DÉPLOIEMENT, ET SEULEMENT APRÈS :                    ##
-- ##                                                                           ##
-- ##      npx supabase functions deploy import-commande                        ##
-- ##                                                                           ##
-- ##  Ordre complet :                                                          ##
-- ##   1. secret_signature_source.sql                                          ##
-- ##   2. npx supabase functions deploy import-commande                        ##
-- ##   3. CE FICHIER                                                           ##
-- ##                                                                           ##
-- ##  CE FICHIER DONNE UN SECRET À CHAQUE SOURCE. L'ANCIEN import-commande     ##
-- ##  VÉRIFIE LA SIGNATURE DÈS QU'UN SECRET EXISTE : EXÉCUTÉ AVANT LE          ##
-- ##  DÉPLOIEMENT, CHAQUE LEAD DE CHAQUE VENDEUR EST REFUSÉ (401), ET          ##
-- ##  WOOCOMMERCE DÉSACTIVE LE WEBHOOK APRÈS ~5 REFUS. LA BASE NE PEUT PAS     ##
-- ##  VOIR QUEL CODE EST DÉPLOYÉ : PERSONNE NE VOUS ARRÊTERA.                  ##
-- #############################################################################
-- =============================================================================
-- Le secret des sources — fichier 2 sur 2 — 20/10/2026
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
--
-- Tout ce qui POSE un secret est ici, et rien d'autre :
--   tr_sources_signature_tirage   tire le secret à la création d'une source
--   §3                            en donne un aux sources déjà en place
--
-- Le secret n'allume rien : avec le nouveau code, la vérification ne démarre
-- que quand le vendeur choisit « Exiger la signature » (signature_entete).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le fichier 1 doit être passé
--
-- Ce fichier s'appuie sur ses colonnes, sa contrainte inversée (sans elle, un
-- secret sans en-tête est refusé) et sur tirer_secret_signature(). Mieux vaut
-- s'arrêter ici avec un message clair qu'au milieu sur une erreur obscure.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'tr_sources_signature_garde' and not tgisinternal)
     or not exists (select 1 from pg_proc
                     where pronamespace = 'public'::regnamespace and proname = 'tirer_secret_signature') then
    raise exception 'Exécutez d''abord secret_signature_source.sql (fichier 1)';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Le tirage à la création
--
-- Un trigger à lui, distinct du garde : rejouer le fichier 1 (à chaque
-- colonne ajoutée à sources_import, CLAUDE.md §6.16) ne doit pas l'effacer.
-- « tirage » passe après « garde » (ordre alphabétique des triggers) : le
-- garde a déjà vérifié que l'utilisateur n'a rien posé lui-même.
-- -----------------------------------------------------------------------------
create or replace function public.sources_signature_tirage()
  returns trigger
  language plpgsql
  set search_path to 'public'
  as $function$
begin
  -- Une feuille Google n'est pas appelée de l'extérieur : pas de secret.
  if new.type = 'webhook' and new.signature_secret is null then
    new.signature_secret  := public.tirer_secret_signature();
    new.secret_change_le  := now();
    new.secret_change_par := auth.uid();
  end if;
  return new;
end;
$function$;

drop trigger if exists tr_sources_signature_tirage on public.sources_import;
create trigger tr_sources_signature_tirage
  before insert on public.sources_import
  for each row execute function public.sources_signature_tirage();

revoke execute on function public.sources_signature_tirage() from public, anon;


-- -----------------------------------------------------------------------------
-- 3. Un secret pour les sources déjà en place
--
-- Il n'allume rien (pas d'en-tête) : avec le nouveau code, la boutique
-- continue exactement comme avant ; le vendeur trouve simplement un secret
-- prêt le jour où il veut signer. `is null` : un secret déjà posé (collé
-- depuis Shopify, régénéré) n'est jamais remplacé, même au rejeu.
-- -----------------------------------------------------------------------------
update public.sources_import
   set signature_secret = public.tirer_secret_signature(),
       secret_change_le = now()
 where type = 'webhook' and signature_secret is null;


-- -----------------------------------------------------------------------------
-- 4. Vérification (lecture seule)
-- Attendu : tirage = 1, webhooks_sans_secret = 0
-- -----------------------------------------------------------------------------
select (select count(*) from pg_trigger
         where tgname = 'tr_sources_signature_tirage' and not tgisinternal) as tirage,
       (select count(*) from public.sources_import
         where type = 'webhook' and signature_secret is null)            as webhooks_sans_secret;
