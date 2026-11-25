-- =============================================================================
-- RÔLES ET PERMISSIONS : UN ENREGISTREMENT QUI NE PEUT PLUS VIDER UN RÔLE,
-- ET LE SUPER ADMIN QUI GARDE TOUT — 03/11/2026
-- =============================================================================
--
-- NE CHANGE AUCUNE PERMISSION EXISTANTE (sauf, si une manquait au rôle
-- super_admin, l'ajout de celle-ci — lu le 03/11 : 57 sur 57, rien à ajouter).
--
-- LES TROUS (lus le 03/11, écran /super-admin/roles et base) :
--   1. « Enregistrer les permissions » SUPPRIMAIT toutes les lignes du rôle,
--      PUIS insérait la nouvelle liste : deux requêtes. La seconde échoue
--      (réseau, onglet fermé) → le rôle reste avec ZÉRO permission. Pour le
--      rôle super_admin, menu_gestion_roles part avec : l'écran qui répare
--      ne s'ouvre plus. Seul le SQL réparait.
--   2. « Supprimer » un rôle supprimait d'abord ses permissions, puis le
--      rôle, en comptant sur un refus « des utilisateurs ont encore ce rôle ».
--      Ce refus N'EXISTE PAS : user_roles.role_id est ON DELETE SET NULL. Le
--      rôle part, et chaque compte qui l'avait perd SILENCIEUSEMENT toutes
--      ses permissions (elles se lisent par role_id). Ex. : supprimer
--      « seller » = 4 vendeurs sans aucun droit.
--   3. Le super admin n'a AUCUN passe-droit dans l'interface (hasPermission
--      lit ses lignes, comme pour tout le monde) : il voit tout parce que
--      quelqu'un a coché toutes les cases, et parce que chaque fichier SQL
--      qui a créé une permission la lui a donnée à la main. Rien ne
--      l'imposait.
--
-- CE QUE FAIT LE FICHIER :
--   §1 Arrêt si le rôle super_admin n'est pas UNE ligne (nom 'super_admin',
--      sans entreprise, rôle système). Lui ajoute toute permission manquante.
--   §2 remplacer_permissions_role(role, codes[]) — LA porte d'enregistrement :
--      super admin seulement ; un seul appel = une seule transaction ; refuse
--      une liste vide (un rôle ne reste jamais sans permission), un code
--      inconnu, et, pour super_admin, toute liste qui n'est pas TOUT. Applique
--      la différence (retire ce qui est décoché, ajoute ce qui est coché).
--   §3 Garde sur role_permissions (tous les chemins, éditeur SQL compris) :
--      aucune ligne du rôle super_admin ne se supprime ni ne se modifie — sauf
--      quand la PERMISSION elle-même est supprimée (cascade : elle n'existe
--      plus pour personne). TRUNCATE refusé (la RLS ne le couvre pas).
--   §4 Toute NOUVELLE permission est donnée au rôle super_admin à sa création
--      (trigger) : « le super admin a tout » devient une règle de la base, pas
--      une case cochée.
--   §5 Garde sur roles : un rôle système (les 7 : le code les lit par leur
--      nom) ne se supprime pas et ne se renomme pas ; un rôle qu'un compte
--      porte encore ne se supprime pas (le compte est nommé). La suppression
--      d'un rôle devient UNE requête : ses permissions partent avec lui
--      (cascade) ou rien ne part.
--   §6 Ferme l'ancienne porte : plus d'écriture directe sur role_permissions
--      depuis le navigateur (politiques d'écriture supprimées, droits
--      insert/update/delete/truncate retirés à authenticated). La lecture ne
--      change pas.
--   §7 RÉPÉTITION (annulée) sous le compte du super admin et d'un manager.
--      Un seul échec → RIEN n'est installé.
--
-- ORDRE : ce fichier, PUIS pousser la page /super-admin/roles. Entre les deux,
-- l'ANCIENNE page échoue proprement : sa suppression ne touche plus aucune
-- ligne (aucune politique), son insertion est refusée → « Erreur lors de la
-- mise à jour », et rien n'a changé. Elle ne peut plus vider un rôle.
--
-- RETOUR ARRIÈRE : roles_permissions_garde_retour.sql (copie sur le Bureau :
-- RETOUR_roles_permissions_garde.sql). Rejouable.
-- =============================================================================

begin;

-- §1 Le rôle super_admin ------------------------------------------------------
create or replace function public.role_super_admin()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  -- Le nom exact que lit is_super_admin() (r.nom = 'super_admin').
  select r.id from public.roles r
   where r.nom = 'super_admin' and r.tenant_id is null and r.is_system;
$$;
revoke all on function public.role_super_admin() from public, anon, authenticated;
grant execute on function public.role_super_admin() to service_role;

do $$
declare n integer; v_ajout integer;
begin
  select count(*) into n from public.roles r
   where r.nom = 'super_admin' and r.tenant_id is null and r.is_system;
  if n <> 1 then
    raise exception 'roles_permissions_garde.sql : % rôle(s) « super_admin » système sans entreprise (1 attendu). Rien n''est installé.', n;
  end if;
  insert into public.role_permissions (role_id, permission_code)
  select public.role_super_admin(), p.code from public.permissions p
  on conflict do nothing;
  get diagnostics v_ajout = row_count;
  raise notice 'super_admin : % permission(s) ajoutée(s) (0 attendu le 03/11).', v_ajout;
end $$;

-- §2 La porte d'enregistrement --------------------------------------------------
create or replace function public.remplacer_permissions_role(p_role uuid, p_codes text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     public.roles%rowtype;
  v_codes    text[];
  v_inconnus text;
  v_manque   text;
  n          integer;
begin
  if not public.is_super_admin() then
    raise exception 'Seul le super admin modifie les permissions d''un rôle.' using errcode = '42501';
  end if;

  -- Verrou : deux enregistrements simultanés du même rôle passent l'un après l'autre.
  select * into v_role from public.roles where id = p_role for update;
  if not found then
    raise exception 'Rôle introuvable (supprimé entre-temps ?). Rechargez la page.';
  end if;

  select coalesce(array_agg(distinct btrim(c)), '{}') into v_codes
    from unnest(coalesce(p_codes, '{}')) c
   where nullif(btrim(c), '') is not null;

  if cardinality(v_codes) = 0 then
    raise exception 'Un rôle ne peut pas rester sans aucune permission : cochez-en au moins une (ou supprimez le rôle s''il ne sert plus).';
  end if;

  select string_agg(c, ', ' order by c) into v_inconnus
    from unnest(v_codes) c
   where not exists (select 1 from public.permissions p where p.code = c);
  if v_inconnus is not null then
    raise exception 'Permission(s) inconnue(s) : %. Rechargez la page.', v_inconnus;
  end if;

  if v_role.id = public.role_super_admin() then
    select string_agg(p.code, ', ' order by p.code) into v_manque
      from public.permissions p where p.code <> all (v_codes);
    if v_manque is not null then
      raise exception 'Le rôle super_admin garde toutes les permissions (il en manquerait : %).', v_manque
        using errcode = '42501';
    end if;
  end if;

  -- La différence, rien d'autre : une ligne inchangée n'est pas touchée.
  delete from public.role_permissions rp
   where rp.role_id = v_role.id and rp.permission_code <> all (v_codes);
  insert into public.role_permissions (role_id, permission_code)
  select v_role.id, c from unnest(v_codes) c
  on conflict do nothing;

  select count(*) into n from public.role_permissions where role_id = v_role.id;
  return n;
end;
$$;
revoke all on function public.remplacer_permissions_role(uuid, text[]) from public, anon;
grant execute on function public.remplacer_permissions_role(uuid, text[]) to authenticated, service_role;

-- §3 Garde sur role_permissions ------------------------------------------------
-- Pas d'exemption « auth.uid() is null » : c'est justement l'éditeur SQL ou un
-- fichier distrait qu'on arrête aussi. Pour vraiment retirer une permission au
-- super admin, on supprime la PERMISSION (elle disparaît pour tout le monde).
create or replace function public.role_permissions_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'TRUNCATE de role_permissions refusé : il viderait chaque rôle, super_admin compris.';
  end if;
  if old.role_id = public.role_super_admin() then
    if tg_op = 'DELETE'
       and not exists (select 1 from public.permissions p where p.code = old.permission_code) then
      return old;   -- la permission elle-même vient d'être supprimée (cascade)
    end if;
    if tg_op = 'UPDATE' and new.role_id = old.role_id and new.permission_code = old.permission_code then
      return new;   -- rien ne change
    end if;
    raise exception 'Le rôle super_admin garde toutes les permissions : « % » ne peut pas lui être retirée.', old.permission_code
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.role_permissions_garde() from public, anon, authenticated;

drop trigger if exists trg_role_permissions_garde on public.role_permissions;
create trigger trg_role_permissions_garde
  before update or delete on public.role_permissions
  for each row execute function public.role_permissions_garde();
drop trigger if exists trg_role_permissions_garde_truncate on public.role_permissions;
create trigger trg_role_permissions_garde_truncate
  before truncate on public.role_permissions
  for each statement execute function public.role_permissions_garde();

-- §4 Une nouvelle permission va au super admin -----------------------------------
create or replace function public.permission_au_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.role_permissions (role_id, permission_code)
  values (public.role_super_admin(), new.code)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.permission_au_super_admin() from public, anon, authenticated;

drop trigger if exists trg_permission_au_super_admin on public.permissions;
create trigger trg_permission_au_super_admin
  after insert on public.permissions
  for each row execute function public.permission_au_super_admin();

-- §5 Garde sur roles -------------------------------------------------------------
create or replace function public.roles_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n integer; v_qui text;
begin
  if tg_op = 'UPDATE' then
    if old.is_system and (new.nom is distinct from old.nom
                          or new.tenant_id is distinct from old.tenant_id
                          or new.is_system is distinct from old.is_system) then
      raise exception 'Le rôle « % » est un rôle du système : le code de l''application le lit par son nom. Il ne se renomme pas.', old.nom
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.is_system then
    raise exception 'Le rôle « % » est un rôle du système : le code de l''application le lit par son nom. Il ne se supprime pas.', old.nom
      using errcode = '42501';
  end if;
  select count(*), string_agg(coalesce(nullif(u.email, ''), u.user_id::text), ', ' order by u.email)
    into n, v_qui
    from public.user_roles u where u.role_id = old.id;
  if n > 0 then
    -- Sans ce refus, user_roles.role_id passerait à NULL (ON DELETE SET NULL)
    -- et ces comptes perdraient toutes leurs permissions sans un mot.
    raise exception '% compte(s) ont encore le rôle « % » (%) : réassignez-les à un autre rôle avant de le supprimer.', n, old.nom, left(v_qui, 300);
  end if;
  return old;
end;
$$;
revoke all on function public.roles_garde() from public, anon, authenticated;

drop trigger if exists trg_roles_garde on public.roles;
create trigger trg_roles_garde
  before update or delete on public.roles
  for each row execute function public.roles_garde();

-- §6 L'ancienne porte se ferme ----------------------------------------------------
drop policy if exists ecriture_role_permissions_super_admin    on public.role_permissions;
drop policy if exists modification_role_permissions_super_admin on public.role_permissions;
drop policy if exists suppression_role_permissions_super_admin  on public.role_permissions;
revoke insert, update, delete, truncate on public.role_permissions from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'role_permissions' and cmd <> 'SELECT') then
    raise exception 'roles_permissions_garde.sql : une politique d''écriture reste sur role_permissions (%). Rien n''est installé.',
      (select string_agg(policyname, ', ') from pg_policies where schemaname = 'public' and tablename = 'role_permissions' and cmd <> 'SELECT');
  end if;
  if has_table_privilege('authenticated', 'public.role_permissions', 'insert')
     or has_table_privilege('authenticated', 'public.role_permissions', 'delete')
     or has_table_privilege('authenticated', 'public.role_permissions', 'truncate') then
    raise exception 'roles_permissions_garde.sql : authenticated écrit encore directement dans role_permissions (un GRANT à PUBLIC ?). Rien n''est installé.';
  end if;
  if not has_function_privilege('authenticated', 'public.remplacer_permissions_role(uuid, text[])', 'execute') then
    raise exception 'roles_permissions_garde.sql : authenticated ne peut pas appeler remplacer_permissions_role. Rien n''est installé.';
  end if;
end $$;

-- §7 Répétition (annulée) -----------------------------------------------------------
do $$
declare
  v_sa      uuid := public.role_super_admin();
  v_sa_user uuid;
  v_mgr     uuid;
  v_role    uuid;
  v_seller  uuid;
  v_avant   integer;
  n         integer;
  v_msg     text;
  v_etape   text := 'préparation';
  v_refus   boolean;
begin
  select user_id into v_sa_user from public.user_roles where role_id = v_sa order by created_at limit 1;
  select user_id into v_mgr from public.user_roles u join public.roles r on r.id = u.role_id
   where r.nom = 'manager' order by u.created_at limit 1;
  select id into v_seller from public.roles where nom = 'seller' and tenant_id is null;
  if v_sa_user is null then
    raise exception 'roles_permissions_garde.sql : aucun compte ne porte le rôle super_admin — la répétition ne peut pas tourner. Rien n''est installé.';
  end if;
  select count(*) into v_avant from public.role_permissions where role_id = v_sa;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_sa_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    v_etape := 'le super admin crée un rôle';
    insert into public.roles (nom, description) values ('REPETITION_' || gen_random_uuid(), 'répétition') returning id into v_role;

    v_etape := 'enregistrer 2 permissions';
    n := public.remplacer_permissions_role(v_role, array['menu_dashboard', 'menu_commandes', 'menu_dashboard']);
    if n <> 2 then raise exception 'attendu 2 permissions, lu %', n; end if;

    v_etape := 'enregistrer 1 permission (une décochée)';
    n := public.remplacer_permissions_role(v_role, array['menu_commandes']);
    if n <> 1 then raise exception 'attendu 1 permission, lu %', n; end if;

    v_etape := 'liste vide refusée';
    v_refus := false;
    begin perform public.remplacer_permissions_role(v_role, array[]::text[]);
    exception when others then v_refus := sqlerrm like '%sans aucune permission%'; end;
    if not v_refus then raise exception 'une liste vide est acceptée'; end if;
    select count(*) into n from public.role_permissions where role_id = v_role;
    if n <> 1 then raise exception 'le refus a quand même touché le rôle (% lignes)', n; end if;

    v_etape := 'code inconnu refusé';
    v_refus := false;
    begin perform public.remplacer_permissions_role(v_role, array['menu_commandes', 'code_qui_n_existe_pas']);
    exception when others then v_refus := sqlerrm like '%inconnue%'; end;
    if not v_refus then raise exception 'un code inconnu est accepté'; end if;

    v_etape := 'écriture directe refusée';
    v_refus := false;
    begin insert into public.role_permissions (role_id, permission_code) values (v_role, 'menu_dashboard');
    exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'le navigateur écrit encore directement dans role_permissions'; end if;

    v_etape := 'super_admin sans menu_gestion_roles refusé';
    v_refus := false;
    begin perform public.remplacer_permissions_role(v_sa,
            array(select code from public.permissions where code <> 'menu_gestion_roles'));
    exception when others then v_refus := sqlerrm like '%menu_gestion_roles%'; end;
    if not v_refus then raise exception 'on retire menu_gestion_roles au super admin'; end if;

    v_etape := 'super_admin : tout cocher passe';
    n := public.remplacer_permissions_role(v_sa, array(select code from public.permissions));
    if n <> v_avant then raise exception 'super_admin : % permissions après, % avant', n, v_avant; end if;

    v_etape := 'supprimer un rôle système refusé';
    v_refus := false;
    begin delete from public.roles where id = v_seller;
    exception when others then v_refus := sqlerrm like '%rôle du système%'; end;
    if not v_refus then raise exception 'le rôle seller se supprime'; end if;

    v_etape := 'supprimer le rôle de répétition (une requête, ses permissions avec)';
    delete from public.roles where id = v_role;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'le rôle de répétition ne s''est pas supprimé'; end if;

    v_etape := 'un manager est refusé';
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
    v_refus := false;
    begin perform public.remplacer_permissions_role(v_seller, array['menu_dashboard']);
    exception when insufficient_privilege then v_refus := true; end;
    if v_mgr is not null and not v_refus then raise exception 'un manager modifie les permissions d''un rôle'; end if;

    execute 'reset role';

    v_etape := 'éditeur SQL : retirer une ligne du super admin refusé';
    v_refus := false;
    begin delete from public.role_permissions where role_id = v_sa and permission_code = 'menu_gestion_roles';
    exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'l''éditeur SQL retire menu_gestion_roles au super admin'; end if;

    v_etape := 'nouvelle permission → au super admin ; supprimée → partie';
    insert into public.permissions (code, nom, module) values ('repetition_garde_roles', 'Répétition', 'Super Admin');
    if not exists (select 1 from public.role_permissions where role_id = v_sa and permission_code = 'repetition_garde_roles') then
      raise exception 'la nouvelle permission n''est pas allée au super admin';
    end if;
    delete from public.permissions where code = 'repetition_garde_roles';
    if exists (select 1 from public.role_permissions where permission_code = 'repetition_garde_roles') then
      raise exception 'la permission supprimée reste sur un rôle';
    end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'roles_permissions_garde.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'roles_permissions_garde.sql : enregistrement atomique, super_admin protégé, rôles système et rôles portés protégés (répétition annulée).';
end $$;

commit;

-- Ce qui est en place
select (select count(*) from public.role_permissions where role_id = public.role_super_admin()) as permissions_super_admin,
       (select count(*) from public.permissions)                                              as permissions_total,
       (select string_agg(tgname, ', ' order by tgname) from pg_trigger
         where tgrelid in ('public.role_permissions'::regclass, 'public.roles'::regclass, 'public.permissions'::regclass)
           and not tgisinternal)                                                               as triggers,
       (select string_agg(cmd || ' ' || policyname, ', ') from pg_policies
         where schemaname = 'public' and tablename = 'role_permissions')                       as politiques_role_permissions;
