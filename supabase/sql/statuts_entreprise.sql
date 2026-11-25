-- =============================================================================
-- Les statuts d'appel d'une entreprise : semés à sa création, partis avec elle
-- 30/10/2026
-- =============================================================================
--
-- LE TROU : `creer-tenant` crée l'entreprise, ses comptes, ses agents… et
-- aucun statut. Les huit (Pending + les sept) ont été posés par SQL dans les
-- deux entreprises existantes. La prochaine entreprise n'aurait aucun
-- vocabulaire : pas de « Pending » (les leads entrent quand même — le trigger
-- l'écrit en texte — mais rien ne l'interprète), pas de « Confirmed » (aucune
-- confirmation possible, donc aucune livraison).
-- Et à l'autre bout : `statuts` n'a aucune clé vers `tenants`. L'entreprise
-- supprimée 53ef8d4e… a laissé 7 lignes derrière elle.
--
-- CE QUE FAIT LE FICHIER :
--   §1 LA liste fixe, dans la base : statuts_standard_liste(). Lue le 30/10
--      dans les deux entreprises existantes (identiques, ligne pour ligne).
--      Pas copiée d'une entreprise à la création : une entreprise modèle qui
--      change ses couleurs changerait celles de toutes les suivantes.
--   §2 contrôle d'installation : à la PREMIÈRE installation (la clé du §4
--      n'existe pas encore), une entreprise dont un statut diffère de la liste
--      arrête le fichier (la liste ne dirait plus ce qui est en place). Aux
--      passages suivants : un avis seulement (un admin peut changer une couleur).
--   §3 les lignes orphelines (entreprise qui n'existe plus) supprimées — mais
--      arrêt si quoi que ce soit d'autre porte encore l'id de cette entreprise.
--   §4 la clé statuts.tenant_id → tenants ON DELETE CASCADE : la configuration
--      part avec son entreprise.
--   §5 statut_pending_fige : la ligne « Pending » se supprime quand SON
--      entreprise n'existe plus (la cascade du §4). Sinon la cascade serait
--      refusée — y compris le nettoyage de `creer-tenant` quand une création
--      échoue à mi-chemin (il supprime l'entreprise qu'il vient de créer).
--      Même corps copié dans statut_pending.sql (le relancer ne le défait pas).
--   §6 semer_statuts(entreprise) + trigger AFTER INSERT sur tenants : chaque
--      nouvelle entreprise reçoit les huit, par TOUT chemin (creer-tenant, clé
--      service, éditeur SQL). N'écrase jamais un statut existant.
--   §7 les entreprises existantes : seulement ce qui leur manque (le 30/10 :
--      rien).
--   §8 vérification ; §9 répétition (créer une entreprise → huit statuts ;
--      la supprimer → plus rien ; le « Pending » d'une entreprise vivante reste
--      insupprimable), annulée.
--
-- CE QUE LE FICHIER NE FAIT PAS : les 16 autres tables qui portent tenant_id
-- sans clé (travail, argent, historique) — un fichier à part (CLAUDE.md §10).
-- Ne change aucune commande, aucun statut existant.
--
-- Retour arrière : statuts_entreprise_retour.sql (+ ~/Desktop/RETOUR_statuts_entreprise.sql).
-- Il ne remet PAS les 7 lignes orphelines (elles ne servaient à rien ; leurs
-- valeurs sont au §3 si jamais).
-- Exécutable en entier, et deux fois.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La liste fixe — la SEULE copie
-- -----------------------------------------------------------------------------
-- Lue le 30/10 dans « FGMED (Données Existantes) » et « Fgmed Angola » : les
-- mêmes huit lignes, type « appel », valables pour tous les pays (pays_id NULL).
create or replace function public.statuts_standard_liste()
returns table (nom text, code text, couleur text, type text,
               declenche_assignation boolean, necessite_rappel boolean, ferme_le_lead boolean)
language sql
immutable
set search_path = public
as $$
  values
    ('Pending',   'pending',   '#C9C1B1', 'appel', false, false, false),
    ('Unreached', 'unreached', '#8a5a1f', 'appel', false, false, false),
    ('Reminder',  'reminder',  '#FFB162', 'appel', false, true,  false),
    ('Confirmed', 'confirmed', '#2E7D53', 'appel', true,  false, true),
    ('Cancelled', 'cancelled', '#A35139', 'appel', false, false, true),
    ('Double',    'double',    '#6B7A8C', 'appel', false, false, true),
    ('Test',      'test',      '#7E6BA8', 'appel', false, false, true),
    ('Spam',      'spam',      '#1B2632', 'appel', false, false, true)
$$;


-- -----------------------------------------------------------------------------
-- 2. Contrôle d'installation : la liste dit-elle ce qui est en place ?
-- -----------------------------------------------------------------------------
do $$
declare
  v_premiere boolean := not exists (select 1 from pg_constraint
                                     where conrelid = 'public.statuts'::regclass
                                       and conname = 'statuts_tenant_id_fkey');
  v_diff text;
begin
  select string_agg(format('%s / %s : %s', t.nom_entreprise, l.nom,
           concat_ws(', ',
             case when s.nom is distinct from l.nom then format('nom « %s »', s.nom) end,
             case when s.couleur is distinct from l.couleur then format('couleur %s', s.couleur) end,
             case when s.type is distinct from l.type then format('type %s', s.type) end,
             case when s.declenche_assignation is distinct from l.declenche_assignation then 'assignation' end,
             case when s.necessite_rappel is distinct from l.necessite_rappel then 'rappel' end,
             case when s.ferme_le_lead is distinct from l.ferme_le_lead then 'ferme le lead' end)), ' ; ')
    into v_diff
    from public.tenants t
    cross join public.statuts_standard_liste() l
    join public.statuts s on s.tenant_id = t.id and s.code = l.code and s.pays_id is null
   where (s.nom, s.couleur, s.type, s.declenche_assignation, s.necessite_rappel, s.ferme_le_lead)
         is distinct from (l.nom, l.couleur, l.type, l.declenche_assignation, l.necessite_rappel, l.ferme_le_lead);

  if v_diff is not null then
    if v_premiere then
      raise exception 'statuts_entreprise.sql : la liste fixe ne dit plus ce qui est en place (%). Elle a été lue le 30/10 ; quelque chose a changé depuis. Relisez les statuts des entreprises et corrigez la liste du §1 avant d''installer. Rien n''a été installé.', v_diff;
    else
      raise notice 'Différences avec la liste fixe (changées depuis l''installation, par exemple une couleur) : %. Rien n''est réécrit.', v_diff;
    end if;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Les lignes orphelines
-- -----------------------------------------------------------------------------
-- Le 30/10 : 7 lignes de l'entreprise supprimée 53ef8d4e-338a-4a7f-8546-b373f7eb6e2d
-- (Cancelled, Confirmed, Double, Reminder, Spam, Test, Unreached ; pas de
-- Pending). Rien d'autre dans la base ne portait cet id.
--
-- SI CE CONTRÔLE ARRÊTE LE FICHIER : quelque chose écrit ENCORE des données
-- pour une entreprise qui n'existe pas (une commande, un appel, un stock…
-- portant son id). Ce n'est pas un problème de statuts, et RELANCER CE FICHIER
-- NE LE RÉGLERA PAS. Il faut trouver ce qui écrit ces lignes (la table et
-- l'id sont dans le message), et décider de ces données, avant de toucher aux
-- statuts.
do $$
declare
  v_orphelins uuid[];
  v_table     text;
  v_n         bigint;
  v_trouve    text := '';
begin
  select array_agg(distinct s.tenant_id) into v_orphelins
    from public.statuts s
   where s.tenant_id is not null
     and not exists (select 1 from public.tenants t where t.id = s.tenant_id);
  if v_orphelins is null then
    raise notice 'Aucun statut orphelin.';
    return;
  end if;

  for v_table in
    select c.table_name from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'tenant_id'
       and tb.table_type = 'BASE TABLE' and c.table_name <> 'statuts'
     order by 1
  loop
    execute format('select count(*) from public.%I where tenant_id = any($1)', v_table) into v_n using v_orphelins;
    if v_n > 0 then v_trouve := v_trouve || format(' %s (%s ligne(s))', v_table, v_n); end if;
  end loop;

  if v_trouve <> '' then
    raise exception 'statuts_entreprise.sql ARRÊTÉ : l''entreprise % n''existe plus, mais des données portent encore son id :%. Quelque chose écrit pour une entreprise supprimée : à chercher, PAS à régler en relançant ce fichier (voir l''en-tête du §3). Rien n''a été installé.',
      array_to_string(v_orphelins, ', '), v_trouve;
  end if;

  delete from public.statuts s where s.tenant_id = any(v_orphelins);
  get diagnostics v_n = row_count;
  raise notice 'Statuts orphelins supprimés : % ligne(s), entreprise(s) %.', v_n, array_to_string(v_orphelins, ', ');
end $$;


-- -----------------------------------------------------------------------------
-- 4. La clé : la configuration part avec son entreprise
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.statuts'::regclass and conname = 'statuts_tenant_id_fkey') then
    alter table public.statuts
      add constraint statuts_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade;
  end if;
end $$;

-- Une clé du même nom mais d'une autre règle (pas CASCADE, autre table) : arrêt.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.statuts'::regclass and conname = 'statuts_tenant_id_fkey'
                    and confrelid = 'public.tenants'::regclass and confdeltype = 'c') then
    raise exception 'statuts_tenant_id_fkey existe mais n''est pas « references tenants on delete cascade » : à regarder à la main.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Le « Pending » part avec son entreprise — jamais seul
-- -----------------------------------------------------------------------------
-- Corps de statut_pending.sql (live le 30/10, md5 d93c86ab…) + l'exception de
-- la cascade. SECURITY DEFINER : la question « l'entreprise existe-t-elle ? »
-- ne doit pas dépendre de ce que l'appelant a le droit de lire dans tenants.
-- MÊME CORPS dans statut_pending.sql : changer l'un, changer l'autre.
create or replace function public.statut_pending_fige()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.code = 'pending' then
    if tg_op = 'DELETE' then
      -- Son entreprise vient d'être supprimée (cascade de statuts_tenant_id_fkey) :
      -- la ligne part avec elle.
      if old.tenant_id is not null
         and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
        return old;
      end if;
      raise exception 'Le statut « Pending » ne se supprime pas : c''est l''état d''un lead que personne n''a encore traité.';
    end if;
    if new.nom is distinct from old.nom or new.code is distinct from old.code
       or new.ferme_le_lead or new.declenche_assignation or new.pays_id is not null then
      raise exception 'Le statut « Pending » ne se renomme pas et ne ferme pas le lead (seule sa couleur peut changer).';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace trigger trg_statut_pending_fige
  before update or delete on public.statuts
  for each row execute function public.statut_pending_fige();


-- -----------------------------------------------------------------------------
-- 6. Semer les statuts d'une entreprise ; à chaque création, par tout chemin
-- -----------------------------------------------------------------------------
-- Ajoute ce qui manque (par code, pays NULL), ne touche jamais une ligne
-- existante. L'index unique (tenant_id, pays_id, code) ne protège pas les
-- lignes à pays NULL : d'où le « not exists ».
create or replace function public.semer_statuts(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.statuts (nom, code, couleur, type, pays_id, tenant_id,
                              declenche_assignation, necessite_rappel, ferme_le_lead)
  select l.nom, l.code, l.couleur, l.type, null, p_tenant,
         l.declenche_assignation, l.necessite_rappel, l.ferme_le_lead
    from public.statuts_standard_liste() l
   where not exists (select 1 from public.statuts s
                      where s.tenant_id = p_tenant and s.pays_id is null
                        and (s.code = l.code or lower(btrim(s.nom)) = lower(l.nom)));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Le trigger et l'éditeur SQL seulement : semer n'est pas un bouton.
revoke execute on function public.semer_statuts(uuid) from public, anon, authenticated;

create or replace function public.tenants_semer_statuts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.semer_statuts(new.id);
  return null;
end;
$$;

revoke execute on function public.tenants_semer_statuts() from public, anon, authenticated;

create or replace trigger trg_tenants_semer_statuts
  after insert on public.tenants
  for each row execute function public.tenants_semer_statuts();


-- -----------------------------------------------------------------------------
-- 7. Les entreprises existantes : ce qui leur manque seulement
-- -----------------------------------------------------------------------------
do $$
declare t record; v_n integer; v_tot integer := 0;
begin
  for t in select id, nom_entreprise from public.tenants order by created_at loop
    v_n := public.semer_statuts(t.id);
    if v_n > 0 then raise notice '% : % statut(s) ajouté(s).', t.nom_entreprise, v_n; end if;
    v_tot := v_tot + v_n;
  end loop;
  raise notice 'Entreprises existantes : % statut(s) ajouté(s) au total.', v_tot;
end $$;


-- -----------------------------------------------------------------------------
-- 8. Vérification
-- -----------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tenants'::regclass
                  and tgname = 'trg_tenants_semer_statuts' and tgenabled <> 'D') then
    raise exception 'trg_tenants_semer_statuts absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.statuts'::regclass
                  and tgname = 'trg_statut_pending_fige' and tgenabled <> 'D') then
    raise exception 'trg_statut_pending_fige absent ou désactivé.';
  end if;
  if position('not exists (select 1 from public.tenants' in
              (select prosrc from pg_proc where oid = 'public.statut_pending_fige()'::regprocedure)) = 0 then
    raise exception 'statut_pending_fige n''a pas l''exception de la cascade : la suppression d''une entreprise serait refusée.';
  end if;
  if has_function_privilege('authenticated', 'public.semer_statuts(uuid)', 'execute')
     or has_function_privilege('anon', 'public.semer_statuts(uuid)', 'execute') then
    raise exception 'semer_statuts est appelable depuis le navigateur.';
  end if;
  select count(*) into v_n from public.tenants t cross join public.statuts_standard_liste() l
   where not exists (select 1 from public.statuts s where s.tenant_id = t.id and s.code = l.code and s.pays_id is null);
  if v_n > 0 then
    raise exception '% statut(s) standard manquant(s) dans les entreprises.', v_n;
  end if;
  if exists (select 1 from public.statuts s where s.tenant_id is not null
              and not exists (select 1 from public.tenants t where t.id = s.tenant_id)) then
    raise exception 'Il reste des statuts orphelins.';
  end if;
  raise notice 'statuts_entreprise.sql : en place.';
end $$;


-- -----------------------------------------------------------------------------
-- 9. Répétition : une entreprise créée puis supprimée. Tout est annulé.
-- -----------------------------------------------------------------------------
do $$
declare
  v_t   uuid;
  v_n   integer;
  v_msg text;
begin
  begin
    insert into public.tenants (nom_entreprise) values ('RÉPÉTITION statuts_entreprise') returning id into v_t;

    select count(*) into v_n
      from public.statuts_standard_liste() l
      join public.statuts s on s.tenant_id = v_t and s.code = l.code and s.pays_id is null
     where (s.nom, s.couleur, s.type, s.declenche_assignation, s.necessite_rappel, s.ferme_le_lead)
           = (l.nom, l.couleur, l.type, l.declenche_assignation, l.necessite_rappel, l.ferme_le_lead);
    if v_n <> 8 or (select count(*) from public.statuts where tenant_id = v_t) <> 8 then
      raise exception 'nouvelle entreprise : % statut(s) conformes sur 8', v_n;
    end if;

    -- Le « Pending » d'une entreprise VIVANTE reste insupprimable.
    begin
      delete from public.statuts where tenant_id = v_t and code = 'pending';
      raise exception 'PENDING_SUPPRIME';
    exception when others then
      if sqlerrm = 'PENDING_SUPPRIME' then
        raise exception 'le « Pending » d''une entreprise vivante a pu être supprimé';
      end if;
    end;

    delete from public.tenants where id = v_t;
    select count(*) into v_n from public.statuts where tenant_id = v_t;
    if v_n <> 0 then raise exception 'entreprise supprimée : % statut(s) restent', v_n; end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'statuts_entreprise.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;
  raise notice 'statuts_entreprise.sql : répétition réussie (création → 8 statuts ; suppression → 0 ; Pending d''une entreprise vivante protégé), tout annulé.';
end $$;

-- Ce qui est en place.
select t.nom_entreprise, count(s.*) as statuts
  from public.tenants t left join public.statuts s on s.tenant_id = t.id
 group by t.nom_entreprise order by 1;
