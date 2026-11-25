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
-- ##  DEUX FICHIERS, TROIS ÉTAPES, DANS CET ORDRE :                            ##
-- ##                                                                           ##
-- ##   1. secret_signature_source.sql              (CE FICHIER) — sans risque, ##
-- ##      à n'importe quel moment : il ne donne de secret à AUCUNE source.     ##
-- ##   2. npx supabase functions deploy import-commande                        ##
-- ##   3. secret_signature_source_2_backfill.sql   — APRÈS LE DÉPLOIEMENT,     ##
-- ##      ET SEULEMENT APRÈS : c'est lui qui donne un secret aux sources.      ##
-- ##                                                                           ##
-- ##  L'ANCIEN import-commande VÉRIFIE LA SIGNATURE DÈS QU'UN SECRET EXISTE.   ##
-- ##  LE FICHIER 2 EXÉCUTÉ AVANT LE DÉPLOIEMENT = CHAQUE LEAD DE CHAQUE        ##
-- ##  VENDEUR REFUSÉ (401), ET WOOCOMMERCE DÉSACTIVE LE WEBHOOK APRÈS ~5       ##
-- ##  REFUS. AUCUN FICHIER NE PEUT LE DÉTECTER : la base ne voit pas le code   ##
-- ##  des Edge Functions déployées.                                           ##
-- ##                                                                           ##
-- ##  Puis : push de la page /sources-import (Vercel).                        ##
-- #############################################################################
-- =============================================================================
-- La CLÉ et le SECRET d'une source — 20/10/2026
-- À exécuter APRÈS rls_sources_import.sql, jeton_source_serveur.sql et
-- intake_generique.sql (déjà en production).
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
--
-- Pourquoi deux fichiers : l'import-commande d'avant le 20/10 vérifie la
-- signature dès qu'un SECRET existe ; le nouveau, seulement si l'EN-TÊTE est
-- posé. Tout ce qui pose un secret (le rattrapage des sources existantes ET
-- le tirage à la création) est donc dans le fichier 2, qui ne doit tourner
-- qu'une fois le nouveau code en ligne. Ce fichier-ci ne pose aucun secret :
-- avec l'ancien code comme avec le nouveau, aucune source ne change de
-- comportement. Une erreur d'ordre sur lui ne casse rien.
-- La page, elle, lit les colonnes ajoutées ici : poussée avant, elle échoue.
--
-- Le vendeur qui vient de ShipLead ou de CodinAfrica connaît deux mots : une
-- clé et un secret. Chez eux le secret est dans l'URL et ne vérifie rien
-- (leur documentation fait taper « CODINAFRICA » dans le champ Secret de
-- WooCommerce). Ici :
--   CLÉ    = le jeton de la source (haché, montré une fois) — dans l'URL
--   SECRET = sources_import.signature_secret — JAMAIS dans l'URL : il sert à
--            vérifier le HMAC que WooCommerce calcule sur chaque commande
--
-- Après ce fichier :
--   tr_sources_signature_garde     refuse toute écriture directe des colonnes
--                                  de signature par un utilisateur connecté
--   (fichier 2 : tr_sources_signature_tirage tire le secret à la création, et
--    les sources existantes reçoivent le leur)
--   (révéler le secret : identifiants_api.sql, derrière le mot de passe)
--   regenerer_secret_source(s)     en tire un nouveau
--   definir_secret_source(s, t)    colle celui que Shopify impose
--   regler_signature_source(s, p)  'aucune' | 'woocommerce' | 'shopify'
--   noter_echec_signature(s)       appelé par import-commande (service role)
--   signature_secret               illisible par un utilisateur connecté : la
--                                  seule porte est reveler_secret_source(s, mot
--                                  de passe), dans identifiants_api.sql
--
-- ⚠ TOUTE COLONNE AJOUTÉE À sources_import ⇒ RÉ-EXÉCUTER CE FICHIER (§8).
--   Sinon elle reste invisible aux utilisateurs connectés et l'écran Sources
--   échoue sur « permission denied for table sources_import ».
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Les colonnes
--
-- secret_change_*  : un secret qui change en silence, c'est la boutique qui
--                    « ne passe plus depuis mardi » sans que personne sache
--                    pourquoi — même raison que jeton_regenere_*.
-- secret_revele_*  : le secret se relit autant qu'on veut ; on garde au moins
--                    qui l'a vu en dernier, pour le jour où une boutique est
--                    abusée.
-- signature_echecs : WooCommerce désactive un webhook après ~5 refus d'affilée.
--                    Le vendeur perd ses commandes sans savoir pourquoi ; ce
--                    compteur répond à « mes commandes n'arrivent plus ».
-- -----------------------------------------------------------------------------
alter table public.sources_import add column if not exists secret_change_le        timestamptz;
alter table public.sources_import add column if not exists secret_change_par       uuid;
alter table public.sources_import add column if not exists secret_revele_le        timestamptz;
alter table public.sources_import add column if not exists secret_revele_par       uuid;
alter table public.sources_import add column if not exists signature_echecs        integer not null default 0;
alter table public.sources_import add column if not exists signature_dernier_echec timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sources_import_secret_change_par_fkey') then
    alter table public.sources_import
      add constraint sources_import_secret_change_par_fkey
      foreign key (secret_change_par) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sources_import_secret_revele_par_fkey') then
    alter table public.sources_import
      add constraint sources_import_secret_revele_par_fkey
      foreign key (secret_revele_par) references auth.users(id) on delete set null;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Le sens de la contrainte s'inverse
--
-- Avant : « un secret exige un en-tête » — poser un secret ALLUMAIT la
-- vérification. Tirer un secret pour chaque source aurait donc fait refuser
-- toutes les landing pages, Zapier et Shopify, qui ne signent pas avec lui.
-- Maintenant : le secret existe toujours, la vérification ne s'allume qu'avec
-- l'en-tête (« Exiger la signature »), et un en-tête exige un secret.
-- Les lignes valides sous l'ancienne règle le sont sous la nouvelle.
-- -----------------------------------------------------------------------------
alter table public.sources_import drop constraint if exists sources_import_signature_complete;
alter table public.sources_import
  add constraint sources_import_signature_complete
  check ((signature_secret is null or length(signature_secret) >= 16)
         and (signature_entete is null or signature_secret is not null));

-- LE SECRET EST RANGÉ LISIBLE, EXPRÈS. Le jeton est haché parce qu'on ne fait
-- que le comparer ; le secret doit SERVIR à recalculer le HMAC de chaque
-- commande, et une empreinte ne calcule rien. Ne pas le « corriger » en hash :
-- la vérification de signature cesserait de marcher pour toutes les sources.
-- Sa protection, c'est le §7 : personne ne le lit hors reveler_secret_source
-- (identifiants_api.sql, derrière le mot de passe du compte).
comment on column public.sources_import.signature_secret is
  'Secret HMAC. LISIBLE exprès (il sert à calculer, pas à comparer). Illisible pour authenticated : passer par reveler_secret_source(source, mot_de_passe). Vérifié seulement si signature_entete est posé.';


-- -----------------------------------------------------------------------------
-- 3. Le tirage
--
-- 24 octets = 192 bits, comme le jeton. « fgs_ » et non « fgm_ » : le vendeur
-- a les deux sous les yeux, et coller le secret à la place de la clé (ou
-- l'inverse) doit se voir au premier coup d'œil.
-- Appelable par tous : une valeur au hasard n'apprend rien à personne, et le
-- garde du §4 (qui tourne avec les droits de l'appelant) en a besoin.
-- -----------------------------------------------------------------------------
create or replace function public.tirer_secret_signature()
  returns text
  language sql
  volatile
  set search_path to 'public'
  as $function$
  select 'fgs_' || encode(extensions.gen_random_bytes(24), 'hex')
$function$;


-- -----------------------------------------------------------------------------
-- 4. Le garde
--
-- Un trigger À PART, et non une modification de sources_jeton_garde :
-- jeton_source_serveur.sql le redéfinit, et le rejouer (ce qui arrive) aurait
-- effacé en silence la garde du secret. Le tirage à la création est un
-- second trigger, dans le fichier 2 (voir l'en-tête) ; « garde » < « tirage »
-- dans l'ordre alphabétique, que Postgres suit : le garde voit la ligne telle
-- que l'utilisateur l'a écrite, avant que le tirage y pose le secret.
--
-- Même règle que le garde du jeton : auth.uid() nul (éditeur SQL, service
-- role) ou current_user propriétaire (on est dans une fonction SECURITY
-- DEFINER de ce fichier) → laissé passer. Un utilisateur connecté, lui, ne
-- touche à aucune de ces colonnes : la console ne doit pas pouvoir poser un
-- secret faible, allumer ou éteindre la vérification, ou effacer les traces.
-- -----------------------------------------------------------------------------
create or replace function public.sources_signature_garde()
  returns trigger
  language plpgsql
  set search_path to 'public'
  as $function$
begin
  if auth.uid() is not null and current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.signature_secret is not null or new.signature_entete is not null
         or new.signature_prefixe is not null
         or new.signature_algo is distinct from 'sha256'
         or new.signature_encodage is distinct from 'base64'
         or new.signature_echecs <> 0 or new.signature_dernier_echec is not null
         or new.secret_change_le is not null or new.secret_change_par is not null
         or new.secret_revele_le is not null or new.secret_revele_par is not null then
        raise exception 'La signature est réglée par le serveur : utilisez les fonctions *_secret_source'
          using errcode = '42501';
      end if;
    elsif new.signature_secret        is distinct from old.signature_secret
       or new.signature_entete        is distinct from old.signature_entete
       or new.signature_prefixe       is distinct from old.signature_prefixe
       or new.signature_algo          is distinct from old.signature_algo
       or new.signature_encodage      is distinct from old.signature_encodage
       or new.signature_echecs        is distinct from old.signature_echecs
       or new.signature_dernier_echec is distinct from old.signature_dernier_echec
       or new.secret_change_le        is distinct from old.secret_change_le
       or new.secret_change_par       is distinct from old.secret_change_par
       or new.secret_revele_le        is distinct from old.secret_revele_le
       or new.secret_revele_par       is distinct from old.secret_revele_par then
      raise exception 'La signature est réglée par le serveur : utilisez les fonctions *_secret_source'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists tr_sources_signature_garde on public.sources_import;
create trigger tr_sources_signature_garde
  before insert or update on public.sources_import
  for each row execute function public.sources_signature_garde();


-- -----------------------------------------------------------------------------
-- 5. Les portes
--
-- Toutes passent par source_geree() : même règle que le jeton
-- (peut_gerer_source), donc PAS le ceo — il lit tout et ne gère rien — et
-- même message pour « inconnue » et « à un autre », pour ne pas dire à un
-- curieux quels identifiants existent.
-- -----------------------------------------------------------------------------
create or replace function public.source_geree(p_source uuid)
  returns public.sources_import
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v public.sources_import%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Réservé à un utilisateur connecté' using errcode = '42501';
  end if;
  select * into v from public.sources_import s where s.id = p_source for update;
  if not found or not public.peut_gerer_source(v.tenant_id, v.vendeur_id) then
    raise exception 'Source introuvable' using errcode = 'P0002';
  end if;
  if v.type <> 'webhook' then
    raise exception 'Une feuille Google n''a pas de secret' using errcode = '22023';
  end if;
  return v;
end;
$function$;

-- Révéler le secret de signature : PAS ICI. La première version, sans mot de
-- passe, laissait le secret le plus important derrière la porte la moins
-- gardée. La révélation vit dans identifiants_api.sql, derrière le mot de
-- passe du compte, le quota et le journal. Supprimée ici aussi pour que
-- rejouer ce fichier ne la recrée jamais.
drop function if exists public.reveler_secret_source(uuid);

-- Remet le compteur d'échecs à zéro : ceux qu'il comptait l'étaient contre
-- l'ancien secret, ils ne disent plus rien sur le nouveau.
-- Ne REND rien : rendre le nouveau secret permettrait de le voir sans le mot
-- de passe (il se relit par reveler_secret_source). Définition identique à
-- celle d'identifiants_api.sql — les deux fichiers doivent rester d'accord.
drop function if exists public.regenerer_secret_source(uuid);
create or replace function public.regenerer_secret_source(p_source uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_secret text := public.tirer_secret_signature();
begin
  perform public.source_geree(p_source);
  update public.sources_import s
     set signature_secret = v_secret,
         secret_change_le = now(), secret_change_par = auth.uid(),
         signature_echecs = 0, signature_dernier_echec = null
   where s.id = p_source;
end;
$function$;

-- Shopify tire son propre secret (Réglages → Notifications → Webhooks) et n'en
-- accepte pas d'autre : le vendeur le colle ici. Pas d'espace, 16 à 200
-- caractères imprimables — un copier-coller raté se voit tout de suite. Les
-- blancs AUTOUR sont retirés, retour à la ligne compris : un copier depuis
-- Shopify en emporte souvent un, et il ferait échouer chaque signature.
create or replace function public.definir_secret_source(p_source uuid, p_secret text)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_secret text := btrim(coalesce(p_secret, ''), E' \t\r\n');
begin
  perform public.source_geree(p_source);
  if v_secret !~ '^[\x21-\x7e]{16,200}$' then
    raise exception 'Secret invalide : 16 à 200 caractères, sans espace' using errcode = '22023';
  end if;
  update public.sources_import s
     set signature_secret = v_secret,
         secret_change_le = now(), secret_change_par = auth.uid(),
         signature_echecs = 0, signature_dernier_echec = null
   where s.id = p_source;
end;
$function$;

-- Trois réglages connus plutôt que quatre colonnes libres : un en-tête mal
-- tapé ferait refuser chaque commande, et le vendeur ne saurait pas pourquoi.
-- 'aucune' garde le secret : on peut rallumer sans le recoller.
create or replace function public.regler_signature_source(p_source uuid, p_plateforme text)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v public.sources_import%rowtype;
  v_entete text;
begin
  v := public.source_geree(p_source);
  case lower(coalesce(p_plateforme, ''))
    when 'aucune'      then v_entete := null;
    when 'woocommerce' then v_entete := 'x-wc-webhook-signature';
    when 'shopify'     then v_entete := 'x-shopify-hmac-sha256';
    else raise exception 'Réglage inconnu : aucune, woocommerce ou shopify' using errcode = '22023';
  end case;
  if v_entete is not null and v.signature_secret is null then
    raise exception 'Cette source n''a pas de secret : régénérez-le d''abord' using errcode = '22023';
  end if;
  -- WooCommerce et Shopify : HMAC-SHA256 en base64, sans préfixe.
  update public.sources_import s
     set signature_entete = v_entete, signature_algo = 'sha256',
         signature_encodage = 'base64', signature_prefixe = null,
         signature_echecs = 0, signature_dernier_echec = null
   where s.id = p_source;
end;
$function$;

-- Appelé par import-commande à chaque signature refusée. Service role
-- seulement : un utilisateur qui pourrait l'appeler gonflerait le compteur
-- d'une source pour faire croire à une attaque.
create or replace function public.noter_echec_signature(p_source uuid)
  returns void
  language sql
  security definer
  set search_path to 'public'
  as $function$
  update public.sources_import
     set signature_echecs = signature_echecs + 1, signature_dernier_echec = now()
   where id = p_source
$function$;


-- -----------------------------------------------------------------------------
-- 6. (Le secret des sources existantes : fichier 2, après le déploiement.)
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 7. Le secret devient illisible pour un utilisateur connecté
--
-- La RLS laisse les responsables lire la LIGNE — ceo compris — et un droit
-- SELECT sur la table couvre toutes ses colonnes : une requête depuis la
-- console lisait donc chaque secret. Postgres ne retire pas une colonne d'un
-- droit donné à la table : on retire le droit sur la table, puis on le rend
-- colonne par colonne, toutes sauf signature_secret.
--
-- La liste est lue dans le catalogue À CHAQUE EXÉCUTION, jamais écrite à la
-- main : une liste figée rendrait invisible la prochaine colonne ajoutée
-- (limite_appels_minute l'a été le 19/10), et l'écran tomberait sur une erreur
-- que personne ne sait lire. pg_attribute plutôt que information_schema :
-- ce dernier ne montre que les colonnes que le rôle courant a le droit de voir.
--
-- anon ne reçoit rien en retour : aucune politique ne lui ouvre une ligne.
-- -----------------------------------------------------------------------------
revoke select on public.sources_import from anon, authenticated;
revoke select (signature_secret) on public.sources_import from anon, authenticated;

do $$
declare
  c record;
begin
  for c in
    select a.attname
      from pg_attribute a
     where a.attrelid = 'public.sources_import'::regclass
       and a.attnum > 0 and not a.attisdropped
       -- cle_api et secret_url : identifiants_api.sql. Exclus ici aussi, sinon
       -- rejouer ce fichier (à chaque colonne ajoutée, §6.16) les rouvrirait.
       -- Un nom absent de la table ne gêne pas : il n'est simplement pas vu.
       and a.attname not in ('signature_secret', 'cle_api', 'secret_url')
  loop
    execute format('grant select (%I) on public.sources_import to authenticated', c.attname);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 8. Droits sur les fonctions
-- -----------------------------------------------------------------------------
revoke execute on function public.tirer_secret_signature()                  from anon;
revoke execute on function public.sources_signature_garde()                 from public, anon;
revoke execute on function public.source_geree(uuid)                        from public, anon, authenticated;
revoke execute on function public.regenerer_secret_source(uuid)             from public, anon;
revoke execute on function public.definir_secret_source(uuid, text)         from public, anon;
revoke execute on function public.regler_signature_source(uuid, text)       from public, anon;
revoke execute on function public.noter_echec_signature(uuid)               from public, anon, authenticated;
grant  execute on function public.tirer_secret_signature()                  to authenticated, service_role;
grant  execute on function public.regenerer_secret_source(uuid)             to authenticated, service_role;
grant  execute on function public.definir_secret_source(uuid, text)         to authenticated, service_role;
grant  execute on function public.regler_signature_source(uuid, text)       to authenticated, service_role;
grant  execute on function public.noter_echec_signature(uuid)               to service_role;


-- -----------------------------------------------------------------------------
-- 9. Vérification
--
-- import-commande calcule le HMAC avec le service role : s'il ne lit plus
-- signature_secret, la vérification de signature meurt en silence, et on ne
-- le découvre que le jour où un vendeur allume « Exiger la signature ».
-- Le §7 ne retire le droit qu'à anon et authenticated, jamais à public : le
-- service role tient le sien d'un GRANT à son nom, mais on le prouve ici.
--
-- Ce bloc LÈVE une erreur si un droit est faux. L'éditeur SQL exécute le
-- fichier d'un seul tenant : l'erreur annule alors TOUT le fichier.
-- -----------------------------------------------------------------------------
do $$
begin
  if not has_column_privilege('service_role', 'public.sources_import', 'signature_secret', 'select') then
    raise exception 'service_role ne lit plus signature_secret : la vérification de signature serait morte';
  end if;
  if not has_column_privilege('service_role', 'public.sources_import', 'nom', 'select') then
    raise exception 'service_role ne lit plus sources_import.nom';
  end if;
  if has_column_privilege('authenticated', 'public.sources_import', 'signature_secret', 'select') then
    raise exception 'authenticated lit encore signature_secret';
  end if;
  if has_column_privilege('anon', 'public.sources_import', 'signature_secret', 'select') then
    raise exception 'anon lit encore signature_secret';
  end if;
  if not has_column_privilege('authenticated', 'public.sources_import', 'nom', 'select') then
    raise exception 'authenticated ne lit plus sources_import.nom : l''écran Sources serait cassé';
  end if;
end $$;

-- Le détail, rôle par rôle (lecture seule). Attendu :
--   service_role   secret TRUE   nom TRUE
--   authenticated  secret FALSE  nom TRUE
--   anon           secret FALSE  nom FALSE   (aucune politique ne lui ouvre une ligne)
select r.role,
       has_column_privilege(r.role, 'public.sources_import', 'signature_secret', 'select') as secret_lisible,
       has_column_privilege(r.role, 'public.sources_import', 'nom', 'select')              as nom_lisible,
       r.attendu
  from (values ('service_role',  'secret TRUE,  nom TRUE'),
               ('authenticated', 'secret FALSE, nom TRUE'),
               ('anon',          'secret FALSE, nom FALSE')) as r(role, attendu);

-- Attendu : limite_lisible = true, garde = 1, fonctions = 5
select has_column_privilege('authenticated', 'public.sources_import', 'limite_appels_minute', 'select') as limite_lisible,
       (select count(*) from pg_trigger where tgname = 'tr_sources_signature_garde' and not tgisinternal) as garde,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('regenerer_secret_source', 'definir_secret_source',
                          'regler_signature_source', 'noter_echec_signature', 'source_geree')) as fonctions;
