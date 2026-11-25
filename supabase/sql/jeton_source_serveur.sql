-- =============================================================================
-- ⚠ DEPUIS LE 20/10 : NE PAS REJOUER CE FICHIER SEUL. identifiants_api.sql
--   redéfinit creer_source_import et regenerer_jeton_source pour qu'elles
--   produisent une source complète (clé lisible + secret d'URL). Rejoué, ce
--   fichier remettrait leurs anciennes versions : le trigger
--   tr_sources_identifiants les refuserait (erreur claire, rien de cassé en
--   silence), mais « Nouvelle source » échouerait jusqu'à ce qu'on rejoue
--   identifiants_api.sql juste après.
-- =============================================================================
-- Jeton des sources d'import tiré par la base — 15/10/2026
-- À exécuter APRÈS rls_sources_import.sql (il utilise a_la_permission et
-- utilisateur_du_tenant), et AVANT de déployer la nouvelle page /sources-import.
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
--
-- Pourquoi : le jeton était tiré dans le navigateur et seule son empreinte
-- partait en base. Celui qui créait la source choisissait donc la valeur —
-- rien n'empêchait « 1234 » — et la base ne pouvait pas en juger : elle ne voit
-- qu'une empreinte, toujours longue de 64 caractères. Le jeton devient aussi
-- une clé de LECTURE (fonction `commande`) : il doit être tiré ici, au hasard,
-- et nulle part ailleurs.
--
-- Après ce fichier :
--   creer_source_import(...)       crée la source, tire le jeton, le rend UNE fois
--   regenerer_jeton_source(source) en tire un nouveau, note qui et quand
--   tr_sources_jeton_garde         refuse toute écriture directe du jeton par
--                                  un utilisateur connecté (console, PostgREST)
--
-- Le format de l'empreinte est celui que lit import-commande (sha256Hex de
-- _shared/import.ts) : SHA-256 en hexadécimal minuscule. Les jetons déjà
-- distribués continuent donc de fonctionner.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Qui a régénéré le jeton, et quand
--
-- Un jeton qui change en silence, c'est un appel au support auquel personne
-- ne sait répondre (« la boutique ne passe plus depuis mardi »).
-- -----------------------------------------------------------------------------
alter table public.sources_import add column if not exists jeton_regenere_le  timestamptz;
alter table public.sources_import add column if not exists jeton_regenere_par uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sources_import_jeton_regenere_par_fkey') then
    alter table public.sources_import
      add constraint sources_import_jeton_regenere_par_fkey
      foreign key (jeton_regenere_par) references auth.users(id) on delete set null;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. La règle « qui peut gérer cette source » — la même que les politiques de
--    rls_sources_import.sql. Les fonctions ci-dessous sont SECURITY DEFINER,
--    donc hors RLS : elles doivent la vérifier elles-mêmes.
-- -----------------------------------------------------------------------------
create or replace function public.peut_gerer_source(p_tenant uuid, p_vendeur uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
  as $function$
  select public.is_super_admin()
      or (p_tenant = public.get_my_tenant_id()
          and (p_vendeur is null or public.utilisateur_du_tenant(p_vendeur, p_tenant))
          and (public.gere_la_config()
               or (p_vendeur = auth.uid() and public.a_la_permission('gerer_mes_sources'))))
$function$;


-- -----------------------------------------------------------------------------
-- 3. Le garde : personne ne pose lui-même la valeur du jeton
--
-- auth.uid() nul = service role, éditeur SQL, cascades de Supabase : on laisse
-- passer (CLAUDE.md §6.4), sinon nos propres outils seraient bloqués.
--
-- current_user différent de authenticated / anon = on est DANS une fonction
-- SECURITY DEFINER (elle s'exécute sous son propriétaire). C'est ce qui laisse
-- passer creer_source_import et regenerer_jeton_source, et un client ne peut
-- pas l'imiter : authenticated n'a le droit d'endosser aucun autre rôle.
-- Un drapeau posé par set_config aurait été plus fragile.
--
-- token_apercu et les deux colonnes d'audit sont gardés aussi : sinon on
-- pourrait faire croire qu'un jeton a changé, ou effacer qui l'a changé.
-- -----------------------------------------------------------------------------
create or replace function public.sources_jeton_garde()
  returns trigger
  language plpgsql
  set search_path to 'public'
  as $function$
begin
  if auth.uid() is null then return new; end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if tg_op = 'INSERT' then
    if new.token_hash is not null or new.token_apercu is not null
       or new.jeton_regenere_le is not null or new.jeton_regenere_par is not null then
      raise exception 'Le jeton est tiré par le serveur : utilisez creer_source_import()'
        using errcode = '42501';
    end if;
  elsif new.token_hash         is distinct from old.token_hash
     or new.token_apercu       is distinct from old.token_apercu
     or new.jeton_regenere_le  is distinct from old.jeton_regenere_le
     or new.jeton_regenere_par is distinct from old.jeton_regenere_par then
    raise exception 'Le jeton est tiré par le serveur : utilisez regenerer_jeton_source()'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists tr_sources_jeton_garde on public.sources_import;
create trigger tr_sources_jeton_garde
  before insert or update on public.sources_import
  for each row execute function public.sources_jeton_garde();


-- -----------------------------------------------------------------------------
-- 4. Créer une source
--
-- 24 octets aléatoires = 192 bits : hors de portée d'un essai à l'aveugle.
-- Le préfixe « fgm_ » sert à reconnaître un jeton collé au mauvais endroit
-- (un log, un ticket) ; il ne compte pas dans l'entropie.
--
-- Le jeton en clair n'est rendu qu'ici, une fois, et n'est écrit nulle part :
-- seule l'empreinte est enregistrée.
-- -----------------------------------------------------------------------------
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
declare
  v_jeton text;
  v_id    uuid;
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

  -- Une feuille Google n'est pas appelée de l'extérieur : pas de jeton.
  if p_type = 'webhook' then
    v_jeton := 'fgm_' || encode(extensions.gen_random_bytes(24), 'hex');
  end if;

  insert into public.sources_import
    (tenant_id, nom, type, vendeur_id, token_hash, token_apercu,
     spreadsheet_id, onglet, created_by)
  values
    (p_tenant, btrim(p_nom), p_type, p_vendeur,
     case when v_jeton is null then null
          else encode(extensions.digest(v_jeton, 'sha256'), 'hex') end,
     right(v_jeton, 4),
     case when p_type = 'google_sheet' then nullif(btrim(p_spreadsheet_id), '') end,
     case when p_type = 'google_sheet' then coalesce(nullif(btrim(p_onglet), ''), 'Feuille 1') end,
     auth.uid())
  returning sources_import.id into v_id;

  return query select v_id, btrim(p_nom), v_jeton;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 5. Régénérer le jeton d'une source
--
-- Même message pour « source inconnue » et « source d'un autre » : les
-- distinguer dirait à un curieux quels identifiants existent.
-- -----------------------------------------------------------------------------
create or replace function public.regenerer_jeton_source(p_source uuid)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_source public.sources_import%rowtype;
  v_jeton  text;
begin
  if auth.uid() is null then
    raise exception 'Réservé à un utilisateur connecté' using errcode = '42501';
  end if;

  select * into v_source from public.sources_import s where s.id = p_source for update;
  if not found or not public.peut_gerer_source(v_source.tenant_id, v_source.vendeur_id) then
    raise exception 'Source introuvable' using errcode = 'P0002';
  end if;
  if v_source.type <> 'webhook' then
    raise exception 'Une feuille Google n''a pas de jeton' using errcode = '22023';
  end if;

  v_jeton := 'fgm_' || encode(extensions.gen_random_bytes(24), 'hex');

  update public.sources_import s
     set token_hash         = encode(extensions.digest(v_jeton, 'sha256'), 'hex'),
         token_apercu       = right(v_jeton, 4),
         jeton_regenere_le  = now(),
         jeton_regenere_par = auth.uid()
   where s.id = p_source;

  return v_jeton;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 6. Droits : appelables par un utilisateur connecté, jamais par anon
-- -----------------------------------------------------------------------------
revoke execute on function public.peut_gerer_source(uuid, uuid)                       from public, anon;
revoke execute on function public.creer_source_import(uuid, text, text, uuid, text, text) from public, anon;
revoke execute on function public.regenerer_jeton_source(uuid)                        from public, anon;
revoke execute on function public.sources_jeton_garde()                               from public, anon;
grant  execute on function public.peut_gerer_source(uuid, uuid)                       to authenticated, service_role;
grant  execute on function public.creer_source_import(uuid, text, text, uuid, text, text) to authenticated, service_role;
grant  execute on function public.regenerer_jeton_source(uuid)                        to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. Vérification (lecture seule)
-- Attendu : garde = 1, fonctions = 2 lignes prosecdef = true, colonnes = 2
-- -----------------------------------------------------------------------------
select count(*) as garde
  from pg_trigger where tgname = 'tr_sources_jeton_garde' and not tgisinternal;

select proname, prosecdef
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('creer_source_import', 'regenerer_jeton_source')
 order by proname;

select count(*) as colonnes
  from information_schema.columns
 where table_schema = 'public' and table_name = 'sources_import'
   and column_name in ('jeton_regenere_le', 'jeton_regenere_par');
