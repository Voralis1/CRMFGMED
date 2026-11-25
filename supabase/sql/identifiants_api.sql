-- =============================================================================
-- ⚠ Signature retirée du produit le 20/10 : dans ce fichier, tout ce qui
--   touche à signature_secret (reveler_secret_source, regenerer_secret_source,
--   le cas 'signature' de reveler_derriere_mot_de_passe, l'exclusion de la
--   colonne dans le §6) reste en place mais n'est plus appelé par l'écran.
--   Le reste — clé API, secret d'URL, mot de passe, quota, journal — est EN
--   SERVICE. C'est ce fichier qu'on rejoue quand une colonne s'ajoute à
--   sources_import (§6 : lecture colonne par colonne).
-- =============================================================================
-- Identifiants API : Clé API + Secret API dans l'URL — 20/10/2026
-- À exécuter APRÈS secret_signature_source.sql (il réutilise source_geree, le
-- même schéma de garde) et après la création de consommer_quota (déjà en
-- production). Rejouable : on peut exécuter tout le fichier plusieurs fois.
--
-- Sans risque dans n'importe quel ordre avec le déploiement ET avec le push :
--   · l'import-commande en ligne ignore les colonnes ajoutées ici ;
--   · le nouveau, déployé avant ce fichier, retombe sur l'ancienne lecture
--     (sourceDepuisJeton) et n'exige aucun secret ;
--   · la page EN LIGNE appelle encore creer_source_import et
--     regenerer_jeton_source : ce fichier les fait passer par les nouvelles
--     fonctions (§4), elle continue donc de marcher et ne crée plus que des
--     sources complètes ;
--   · secret_url_requis vaut false par défaut : une source existante ne change
--     pas de comportement.
--
-- TROIS VALEURS, À NE JAMAIS CONFONDRE :
--   cle_api           (fgm_…)  dans l'URL — identifie la source
--   secret_url        (fgu_…)  dans l'URL — familiarité, pas protection
--   signature_secret  (fgs_…)  dans le champ « Secret » de WooCommerce — la
--                              SEULE qui prouve que le corps vient de la
--                              boutique et n'a pas été modifié (HMAC)
--
-- POURQUOI UN SECRET DANS L'URL, ALORS ? Les vendeurs viennent de ShipLead et
-- de CodinAfrica, dont l'URL porte `?key=…&secret=…`, et leur intégrateur
-- prend une URL sans `&secret=` pour incomplète. Soyons honnêtes : deux
-- valeurs qui voyagent dans la même URL sont UN long mot de passe, pas deux
-- facteurs — qui voit l'URL a les deux. Cela achète la familiarité et une
-- migration facile, rien de plus. La protection réelle reste la signature.
--
-- secret_url N'EST PAS signature_secret, et ne doit jamais le devenir : une
-- URL finit dans les journaux (boutique, proxys, plateforme). Si le même texte
-- servait de clé HMAC, une seule ligne de journal lue suffirait à forger une
-- signature valide, et on perdrait la seule vraie protection qu'on a.
--
-- UNE SEULE PORTE PAR ÉTAT. Une source webhook naît complète (clé lisible +
-- secret d'URL) et sa clé ne change qu'avec sa copie lisible. Le trigger du §3
-- REFUSE tout le reste, quel que soit le chemin — y compris les anciennes
-- fonctions si jeton_source_serveur.sql était rejoué. Un état à moitié fait
-- (panneau vide, sans que le vendeur sache pourquoi) ne peut plus exister.
--
-- Après ce fichier :
--   creer_source_api(...)                  crée la source : clé + secret d'URL
--   creer_source_import(...)               ANCIENNE porte, même résultat (§4)
--   identifiants_source(s)                 la clé, à qui gère la source
--   reveler_secret_url(s, mot_de_passe)    le secret d'URL     } mot de passe,
--   reveler_secret_source(s, mot_de_passe) le secret de signature} quota, journal
--   regenerer_identifiants_source(s)       nouvelle clé + nouveau secret d'URL
--   regenerer_jeton_source(s)              ANCIENNE porte, même résultat (§4)
--   exiger_secret_url(s, bool)             l'exiger ou non sur une source
--   journal_revelations                    chaque tentative, réussie ou non
--
-- ⚠ TOUTE COLONNE AJOUTÉE À sources_import ⇒ rejouer secret_signature_source.sql
--   PUIS ce fichier (CLAUDE.md §6.16) : les deux rendent la lecture colonne
--   par colonne, en excluant les trois colonnes secrètes.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Les colonnes
--
-- cle_api : la clé, LISIBLE, en plus de token_hash qui reste la porte de
-- recherche (import-commande cherche par empreinte, comme avant). La garder
-- lisible permet de la réafficher à tout moment, comme chez ShipLead.
--
-- Le prix, dit tel qu'il est : avec une clé hachée, une copie de la base
-- (sauvegarde, export) ne permettait d'entrer nulle part — signature_secret
-- seul ne fait passer aucun lead. Avec la clé lisible, la même copie donne de
-- quoi POUSSER des leads dans chaque entreprise. On l'accepte pour cette
-- raison : une copie de la base livre DÉJÀ les commandes, les clients et leurs
-- numéros de téléphone — c'est ça, la perte. « Et en plus on pourrait pousser
-- des leads » est petit à côté : le dommage se borne à créer des leads (rien
-- lu, rien supprimé, pas d'argent), sous quota, et une source se coupe en un
-- clic. Perdre une URL, à l'inverse, arrive souvent et arrête une vraie
-- boutique. D'où : lisible. Durcissement possible plus tard : Supabase Vault
-- (installé) pour chiffrer les trois valeurs au repos.
--
-- secret_url : LISIBLE lui aussi, et ne peut PAS être haché : le vendeur doit
-- pouvoir le révéler plus tard, et une empreinte ne se révèle pas.
-- -----------------------------------------------------------------------------
alter table public.sources_import add column if not exists cle_api           text;
alter table public.sources_import add column if not exists secret_url        text;
alter table public.sources_import add column if not exists secret_url_requis boolean not null default false;

-- Exigé sans secret = toute la boutique refusée, sans que personne comprenne.
alter table public.sources_import drop constraint if exists sources_import_secret_url_complet;
alter table public.sources_import
  add constraint sources_import_secret_url_complet
  check (not secret_url_requis or secret_url is not null);

comment on column public.sources_import.cle_api is
  'Clé API en clair (copie d''affichage). La recherche passe par token_hash. NULL seulement pour une source créée avant le 20/10.';
comment on column public.sources_import.secret_url is
  'Secret API de l''URL (&secret=). LISIBLE exprès (il se révèle). Familiarité, pas protection : JAMAIS réutilisé comme clé HMAC (voir signature_secret).';


-- -----------------------------------------------------------------------------
-- 2. Le journal des révélations
--
-- Chaque tentative, réussie ou non, sur l'un ou l'autre secret : une suite
-- d'échecs sur un compte est LE signal qu'on devine son mot de passe. Pas de
-- clé étrangère sur source_id : une tentative sur une source inexistante doit
-- être notée aussi. Personne ne le lit depuis le navigateur.
-- -----------------------------------------------------------------------------
create table if not exists public.journal_revelations (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  source_id  uuid,
  quoi       text,
  succes     boolean not null,
  -- 'ok' | 'refus' (mot de passe faux OU source interdite — on ne les
  -- distingue même pas ici : la cause exacte serait un oracle de plus) | 'limite'
  motif      text not null,
  created_at timestamptz not null default now()
);
alter table public.journal_revelations add column if not exists quoi text;
create index if not exists idx_journal_revelations_user on public.journal_revelations (user_id, created_at desc);
alter table public.journal_revelations enable row level security;
revoke all on public.journal_revelations from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. Le garde, et l'état qui ne peut plus être à moitié fait
--
-- Garde : un utilisateur connecté n'écrit aucune des trois colonnes ; elles
-- passent par les fonctions ci-dessous (même règle que les autres gardes :
-- fonction SECURITY DEFINER → laissée passer).
--
-- État complet, pour TOUT le monde, éditeur SQL compris : une source webhook
-- qui naît, ou dont la clé change, porte sa clé lisible (celle dont token_hash
-- est l'empreinte) et un secret d'URL. Sinon : refus, avec le nom de la bonne
-- fonction. On refuse au lieu de réparer en silence (vider cle_api) : une
-- clé vide, c'est un vendeur devant un panneau vide sans savoir pourquoi —
-- c'est exactement l'état qu'on supprime. Seules les sources nées avant ce
-- fichier gardent cle_api NULL, tant que leur clé ne change pas.
-- -----------------------------------------------------------------------------
create or replace function public.sources_identifiants()
  returns trigger
  language plpgsql
  set search_path to 'public'
  as $function$
begin
  if auth.uid() is not null and current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.cle_api is not null or new.secret_url is not null or new.secret_url_requis then
        raise exception 'Les identifiants sont tirés par le serveur : utilisez creer_source_api()'
          using errcode = '42501';
      end if;
    elsif new.cle_api           is distinct from old.cle_api
       or new.secret_url        is distinct from old.secret_url
       or new.secret_url_requis is distinct from old.secret_url_requis then
      raise exception 'Les identifiants sont tirés par le serveur : utilisez regenerer_identifiants_source()'
        using errcode = '42501';
    end if;
  end if;

  if new.cle_api is not null
     and new.token_hash is distinct from encode(extensions.digest(new.cle_api, 'sha256'), 'hex') then
    raise exception 'cle_api ne correspond pas à token_hash : utilisez regenerer_identifiants_source()'
      using errcode = '23514';
  end if;

  if new.type = 'webhook'
     and (tg_op = 'INSERT' or new.token_hash is distinct from old.token_hash)
     and (new.cle_api is null or new.secret_url is null) then
    raise exception 'Source webhook incomplète : créez-la par creer_source_api() et changez sa clé par regenerer_identifiants_source()'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists tr_sources_identifiants on public.sources_import;
create trigger tr_sources_identifiants
  before insert or update on public.sources_import
  for each row execute function public.sources_identifiants();


-- -----------------------------------------------------------------------------
-- 4. Les portes
--
-- Deux fonctions internes font TOUT le travail ; les portes publiques, les
-- nouvelles comme les anciennes, ne font que les appeler. Les anciennes
-- (creer_source_import, regenerer_jeton_source) restent ouvertes parce que la
-- page en ligne les appelle encore jusqu'au push ; elles ne peuvent plus
-- produire qu'une source complète.
-- -----------------------------------------------------------------------------

-- « fgu_ » : ni « fgm_ » (la clé) ni « fgs_ » (la signature). Trois valeurs
-- côte à côte sur l'écran : coller l'une à la place de l'autre doit se voir.
create or replace function public.tirer_secret_url()
  returns text
  language sql
  volatile
  set search_path to 'public'
  as $function$
  select 'fgu_' || encode(extensions.gen_random_bytes(24), 'hex')
$function$;

-- Créer : les vérifications de jeton_source_serveur.sql (droits, nom, type),
-- et la clé lisible + le secret d'URL posés dans le MÊME insert.
create or replace function public.source_creer_complete (
  p_tenant uuid, p_nom text, p_type text, p_vendeur uuid,
  p_spreadsheet_id text, p_onglet text, p_secret_requis boolean
)
  returns table (id uuid, nom text, jeton text)
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_jeton  text;
  v_secret text;
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'Réservé à un utilisateur connecté' using errcode = '42501';
  end if;
  if not public.peut_gerer_source(p_tenant, p_vendeur) then
    raise exception 'Création refusée' using errcode = '42501';
  end if;
  if coalesce(btrim(p_nom), '') = '' then
    raise exception 'Donnez un nom à la source' using errcode = '22023';
  end if;
  if p_type not in ('webhook', 'google_sheet') then
    raise exception 'Type de source inconnu' using errcode = '22023';
  end if;

  -- Une feuille Google n'est pas appelée de l'extérieur : ni clé ni secret.
  if p_type = 'webhook' then
    v_jeton  := 'fgm_' || encode(extensions.gen_random_bytes(24), 'hex');
    v_secret := public.tirer_secret_url();
  end if;

  insert into public.sources_import
    (tenant_id, nom, type, vendeur_id, token_hash, token_apercu,
     cle_api, secret_url, secret_url_requis,
     spreadsheet_id, onglet, created_by)
  values
    (p_tenant, btrim(p_nom), p_type, p_vendeur,
     case when v_jeton is null then null
          else encode(extensions.digest(v_jeton, 'sha256'), 'hex') end,
     right(v_jeton, 4),
     v_jeton, v_secret, p_type = 'webhook' and coalesce(p_secret_requis, false),
     case when p_type = 'google_sheet' then nullif(btrim(p_spreadsheet_id), '') end,
     case when p_type = 'google_sheet' then coalesce(nullif(btrim(p_onglet), ''), 'Feuille 1') end,
     auth.uid())
  returning sources_import.id into v_id;

  return query select v_id, btrim(p_nom), v_jeton;
end;
$function$;

-- Régénérer : clé ET secret d'URL ensemble — ils voyagent dans la même URL,
-- une fuite expose toujours les deux. Même audit que l'ancienne porte.
-- Même message pour « inconnue » et « à un autre ».
create or replace function public.source_regenerer_complete(p_source uuid)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v public.sources_import%rowtype;
  v_jeton text;
begin
  if auth.uid() is null then
    raise exception 'Réservé à un utilisateur connecté' using errcode = '42501';
  end if;
  select * into v from public.sources_import s where s.id = p_source for update;
  if not found or not public.peut_gerer_source(v.tenant_id, v.vendeur_id) then
    raise exception 'Source introuvable' using errcode = 'P0002';
  end if;
  if v.type <> 'webhook' then
    raise exception 'Une feuille Google n''a pas de jeton' using errcode = '22023';
  end if;

  v_jeton := 'fgm_' || encode(extensions.gen_random_bytes(24), 'hex');
  update public.sources_import s
     set token_hash         = encode(extensions.digest(v_jeton, 'sha256'), 'hex'),
         token_apercu       = right(v_jeton, 4),
         cle_api            = v_jeton,
         secret_url         = public.tirer_secret_url(),
         jeton_regenere_le  = now(),
         jeton_regenere_par = auth.uid()
   where s.id = p_source;
  return v_jeton;
end;
$function$;

-- p_secret_requis : true pour une boutique (on lui donne une URL complète),
-- false pour Zapier / formulaire / script, qui envoient la clé seule.
create or replace function public.creer_source_api (
  p_tenant         uuid,
  p_nom            text,
  p_type           text,
  p_vendeur        uuid    default null,
  p_spreadsheet_id text    default null,
  p_onglet         text    default null,
  p_secret_requis  boolean default true
)
  returns table (id uuid, nom text)
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  return query
    select c.id, c.nom
      from public.source_creer_complete(p_tenant, p_nom, p_type, p_vendeur,
                                        p_spreadsheet_id, p_onglet, coalesce(p_secret_requis, true)) c;
end;
$function$;

-- ANCIENNE porte (jeton_source_serveur.sql), gardée pour la page en ligne
-- jusqu'au push. Même signature, même retour (le jeton montré une fois), mais
-- la source naît complète. Secret d'URL NON exigé : cette page donne une URL
-- sans &secret= ; l'exiger ferait refuser la boutique qu'on vient de brancher.
create or replace function public.creer_source_import (
  p_tenant         uuid,
  p_nom            text,
  p_type           text,
  p_vendeur        uuid default null,
  p_spreadsheet_id text default null,
  p_onglet         text default null
)
  returns table (id uuid, nom text, jeton text)
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  return query
    select c.id, c.nom, c.jeton
      from public.source_creer_complete(p_tenant, p_nom, p_type, p_vendeur,
                                        p_spreadsheet_id, p_onglet, false) c;
end;
$function$;

-- ANCIENNE porte, même raison. Rend le jeton comme avant ; la copie lisible
-- et le secret d'URL suivent.
create or replace function public.regenerer_jeton_source(p_source uuid)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  return public.source_regenerer_complete(p_source);
end;
$function$;

-- Rien n'est rendu : le secret se relit par reveler_secret_url, donc derrière
-- le mot de passe — sinon régénérer serait un moyen de le voir sans.
create or replace function public.regenerer_identifiants_source(p_source uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  perform public.source_regenerer_complete(p_source);
end;
$function$;

-- La clé n'est pas derrière le mot de passe : elle s'affiche comme chez
-- ShipLead.
create or replace function public.identifiants_source(p_source uuid)
  returns table (cle text, secret_url_requis boolean, secret_url_existe boolean)
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v public.sources_import%rowtype;
begin
  v := public.source_geree(p_source);
  return query select v.cle_api, v.secret_url_requis, v.secret_url is not null;
end;
$function$;

-- Allumer ou éteindre l'exigence. Allumer sans secret en tire un : sinon la
-- contrainte refuserait, ou pire, toute la boutique le serait.
create or replace function public.exiger_secret_url(p_source uuid, p_exiger boolean)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v public.sources_import%rowtype;
begin
  v := public.source_geree(p_source);
  update public.sources_import s
     set secret_url        = coalesce(s.secret_url, case when p_exiger then public.tirer_secret_url() end),
         secret_url_requis = coalesce(p_exiger, false)
   where s.id = p_source;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 5. Révéler un secret : derrière le mot de passe du compte, les DEUX
--
-- Le secret de signature est le PLUS important des deux, pas le moins : le
-- secret d'URL n'est que de la familiarité, celui de signature est la seule
-- preuve qu'une commande vient de la boutique. Il ne peut pas être celui
-- qu'on laisse sans garde. Une seule fonction pour les deux : même mot de
-- passe, même quota (la même clé : deviner sur l'un consomme l'autre), même
-- journal, mêmes réponses indiscernables.
--
-- Vérifié ICI, et non dans le navigateur par signInWithPassword : celui-ci
-- ouvre une nouvelle session au passage, et un échec ressemble à un problème
-- de connexion. crypt(mot_de_passe, empreinte) = empreinte vérifie le bcrypt
-- d'auth.users sans toucher à la session.
--
-- C'est un oracle de mot de passe, donc clôturé :
--   · quota (consommer_quota, le compteur qu'on a déjà) : 5 par minute ET 20
--     par heure et par compte — 5/min seul laisserait 7 200 essais par jour ;
--   · chaque tentative est écrite dans journal_revelations ;
--   · MÊME réponse pour « mauvais mot de passe » et « source qu'on ne gère pas
--     ou qui n'existe pas » : la fonction ne dit jamais ce qui existe.
--
-- Elle ne LÈVE PAS d'erreur sur un échec : une exception annulerait la
-- transaction, donc la ligne de journal ET le compte du quota — l'attaquant
-- essaierait gratuitement et sans trace. Elle rend ok = false.
-- Le quota, lui, échoue FERMÉ (contrairement à import-commande) : sans
-- compteur, on ne révèle rien plutôt que d'ouvrir un oracle illimité.
-- -----------------------------------------------------------------------------
create or replace function public.reveler_derriere_mot_de_passe(
  p_source uuid, p_mot_de_passe text, p_quoi text
)
  returns table (ok boolean, secret text, reessayer_dans integer)
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_uid     uuid := auth.uid();
  q_min     record;
  q_heure   record;
  v_hash    text;
  v_mdp_ok  boolean;
  v_source  public.sources_import%rowtype;
  v_valeur  text;
  v_peut    boolean;
begin
  if v_uid is null then
    raise exception 'Réservé à un utilisateur connecté' using errcode = '42501';
  end if;
  if p_quoi not in ('secret_url', 'signature') then
    raise exception 'Secret inconnu' using errcode = '22023';
  end if;

  -- Les deux fenêtres comptent chaque tentative, même celle qui sera refusée.
  select * into q_min   from public.consommer_quota('reveal:' || v_uid, 1, 5, 5, 60);
  select * into q_heure from public.consommer_quota('reveal-h:' || v_uid, 1, 20, 20, 3600);
  if not q_min.autorise or not q_heure.autorise then
    insert into public.journal_revelations (user_id, source_id, quoi, succes, motif)
    values (v_uid, p_source, p_quoi, false, 'limite');
    return query select false, null::text,
      case when not q_heure.autorise then q_heure.reset_dans else q_min.reset_dans end;
    return;
  end if;

  -- Le mot de passe est vérifié AVANT de regarder la source, et toujours :
  -- sinon « source interdite » répondrait plus vite que « mauvais mot de
  -- passe », et le temps de réponse dirait ce qui existe.
  select u.encrypted_password into v_hash from auth.users u where u.id = v_uid;
  v_mdp_ok := coalesce(v_hash, '') <> ''
              and extensions.crypt(coalesce(p_mot_de_passe, ''), v_hash) = v_hash;

  select * into v_source from public.sources_import s where s.id = p_source;
  v_peut := found
            and v_source.type = 'webhook'
            and public.peut_gerer_source(v_source.tenant_id, v_source.vendeur_id);
  v_valeur := case p_quoi when 'secret_url' then v_source.secret_url else v_source.signature_secret end;

  if not (v_mdp_ok and v_peut and v_valeur is not null) then
    insert into public.journal_revelations (user_id, source_id, quoi, succes, motif)
    values (v_uid, p_source, p_quoi, false, 'refus');
    return query select false, null::text, 0;
    return;
  end if;

  insert into public.journal_revelations (user_id, source_id, quoi, succes, motif)
  values (v_uid, p_source, p_quoi, true, 'ok');
  -- La date affichée sur l'écran (« dernière lecture »), pour la signature.
  if p_quoi = 'signature' then
    update public.sources_import s
       set secret_revele_le = now(), secret_revele_par = v_uid
     where s.id = p_source;
  end if;
  return query select true, v_valeur, 0;
end;
$function$;

create or replace function public.reveler_secret_url(p_source uuid, p_mot_de_passe text)
  returns table (ok boolean, secret text, reessayer_dans integer)
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  return query
    select r.ok, r.secret, r.reessayer_dans
      from public.reveler_derriere_mot_de_passe(p_source, p_mot_de_passe, 'secret_url') r;
end;
$function$;

-- L'ancienne version, sans mot de passe (secret_signature_source.sql), est
-- SUPPRIMÉE : la laisser, c'était laisser le secret le plus important derrière
-- la porte la moins gardée. Aucune page en ligne ne l'appelle.
drop function if exists public.reveler_secret_source(uuid);

create or replace function public.reveler_secret_source(p_source uuid, p_mot_de_passe text)
  returns table (ok boolean, secret text, reessayer_dans integer)
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
begin
  return query
    select r.ok, r.secret, r.reessayer_dans
      from public.reveler_derriere_mot_de_passe(p_source, p_mot_de_passe, 'signature') r;
end;
$function$;


-- Régénérer le secret de signature ne le REND plus (il le rendait, dans
-- secret_signature_source.sql tel qu'il a été exécuté) : sinon « Régénérer »
-- serait le moyen de voir ce secret sans le mot de passe. Il se relit par
-- reveler_secret_source. Le type de retour change : on supprime, puis on
-- recrée. Définition identique à celle de secret_signature_source.sql.
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


-- -----------------------------------------------------------------------------
-- 6. La lecture : cle_api et secret_url rejoignent signature_secret
--
-- Même mécanique que secret_signature_source.sql §7, avec les trois colonnes
-- exclues. Les deux fichiers excluent la même liste : rejouer l'un ou
-- l'autre ne rouvre rien.
-- -----------------------------------------------------------------------------
revoke select on public.sources_import from anon, authenticated;
revoke select (signature_secret, cle_api, secret_url) on public.sources_import from anon, authenticated;

do $$
declare
  c record;
begin
  for c in
    select a.attname
      from pg_attribute a
     where a.attrelid = 'public.sources_import'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname not in ('signature_secret', 'cle_api', 'secret_url')
  loop
    execute format('grant select (%I) on public.sources_import to authenticated', c.attname);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 7. Droits sur les fonctions
--
-- Les fonctions internes ne s'appellent que de l'intérieur (SECURITY DEFINER
-- les exécute sous leur propriétaire) : fermées à tous les rôles de l'API.
-- -----------------------------------------------------------------------------
revoke execute on function public.sources_identifiants()                                         from public, anon;
revoke execute on function public.tirer_secret_url()                                             from public, anon, authenticated;
revoke execute on function public.source_creer_complete(uuid, text, text, uuid, text, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.source_regenerer_complete(uuid)                                from public, anon, authenticated, service_role;
revoke execute on function public.reveler_derriere_mot_de_passe(uuid, text, text)                from public, anon, authenticated, service_role;
revoke execute on function public.creer_source_api(uuid, text, text, uuid, text, text, boolean)   from public, anon;
revoke execute on function public.creer_source_import(uuid, text, text, uuid, text, text)         from public, anon;
revoke execute on function public.identifiants_source(uuid)                                      from public, anon;
revoke execute on function public.reveler_secret_url(uuid, text)                                 from public, anon;
-- 23/10 : les deux portes de la SIGNATURE restent fermées à tous, même quand ce
-- fichier est relancé (§6.16 de CLAUDE.md le fait relancer à chaque colonne
-- ajoutée). Fermées par signature_fonctions_fermer.sql ; les rouvrir, c'est
-- signature_fonctions_rouvrir.sql, jamais ce fichier.
revoke execute on function public.reveler_secret_source(uuid, text)                              from public, anon, authenticated, service_role;
revoke execute on function public.regenerer_identifiants_source(uuid)                            from public, anon;
revoke execute on function public.regenerer_jeton_source(uuid)                                   from public, anon;
revoke execute on function public.regenerer_secret_source(uuid)                                  from public, anon, authenticated, service_role;
revoke execute on function public.exiger_secret_url(uuid, boolean)                               from public, anon;
grant  execute on function public.creer_source_api(uuid, text, text, uuid, text, text, boolean)   to authenticated, service_role;
grant  execute on function public.creer_source_import(uuid, text, text, uuid, text, text)         to authenticated, service_role;
grant  execute on function public.identifiants_source(uuid)                                      to authenticated, service_role;
grant  execute on function public.reveler_secret_url(uuid, text)                                 to authenticated, service_role;
grant  execute on function public.regenerer_identifiants_source(uuid)                            to authenticated, service_role;
grant  execute on function public.regenerer_jeton_source(uuid)                                   to authenticated, service_role;
grant  execute on function public.exiger_secret_url(uuid, boolean)                               to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 8. Vérification
--
-- import-commande compare le secret d'URL avec le service role : s'il ne le
-- lit plus, toute source qui l'exige est refusée en entier. Ce bloc LÈVE si
-- un droit est faux ou si la porte sans mot de passe existe encore ;
-- l'éditeur SQL étant transactionnel, il annule alors tout le fichier.
-- -----------------------------------------------------------------------------
do $$
declare
  col text;
begin
  foreach col in array array['signature_secret', 'cle_api', 'secret_url'] loop
    if not has_column_privilege('service_role', 'public.sources_import', col, 'select') then
      raise exception 'service_role ne lit plus sources_import.% : import-commande serait cassé', col;
    end if;
    if has_column_privilege('authenticated', 'public.sources_import', col, 'select') then
      raise exception 'authenticated lit encore sources_import.%', col;
    end if;
    if has_column_privilege('anon', 'public.sources_import', col, 'select') then
      raise exception 'anon lit encore sources_import.%', col;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.sources_import', 'secret_url_requis', 'select') then
    raise exception 'authenticated ne lit pas secret_url_requis : l''écran Sources serait cassé';
  end if;
  if to_regprocedure('public.reveler_secret_source(uuid)') is not null then
    raise exception 'reveler_secret_source(uuid), sans mot de passe, existe encore';
  end if;
  if (select prorettype from pg_proc where oid = to_regprocedure('public.regenerer_secret_source(uuid)'))
     is distinct from 'void'::regtype then
    raise exception 'regenerer_secret_source rend encore le secret';
  end if;
end $$;

-- Le détail (lecture seule). Attendu : service_role TRUE partout ;
-- authenticated et anon FALSE sur les trois.
select r.role,
       has_column_privilege(r.role, 'public.sources_import', 'cle_api', 'select')          as cle_api,
       has_column_privilege(r.role, 'public.sources_import', 'secret_url', 'select')       as secret_url,
       has_column_privilege(r.role, 'public.sources_import', 'signature_secret', 'select') as signature_secret
  from (values ('service_role'), ('authenticated'), ('anon')) as r(role);
