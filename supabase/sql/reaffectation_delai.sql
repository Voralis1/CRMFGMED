-- =============================================================================
-- T21 — UN LEAD QUE PERSONNE N'OUVRE PASSE À UN AUTRE AGENT — 13/11/2026 (sa décision)
-- NE MODIFIE AUCUNE COMMANDE À L'INSTALLATION. Ajoute des colonnes, une horloge, une
-- tâche toutes les 5 minutes (pg_cron).
-- =============================================================================
--
-- AVANT (lu en prod le 13/11) : l'agent est choisi UNE fois, à l'arrivée du lead
-- (choisir_agent : l'agent actif du pays qui a le moins de « Pending »). Ensuite
-- plus rien : Fgmed Angola a 9 leads « En attente », le plus vieux du 10/11 17:16.
-- Le CRM ne savait pas quand un agent ouvrait un lead.
--
-- SES RÈGLES (12–13/11) :
--   · délai : 1 heure (réglable par entreprise : tenants.delai_reaffectation_minutes,
--     5 à 480, pour tester vite) — réglé par l'entreprise elle-même (sa décision 13/11) :
--     admin et manager dans Paramètres (fixer_delai_reaffectation), super admin aussi ;
--   · l'horloge ne tourne qu'aux heures de travail, À L'HEURE DU PAYS du lead :
--     lundi–vendredi 8:00–18:00, samedi 8:00–12:00, dimanche fermé ;
--     pays.fuseau, rempli depuis le code ISO (AO → Africa/Luanda…) ;
--   · « traité » = l'agent DU LEAD clique « Traiter » dans le Centre d'appel
--     (marquer_lead_ouvert : un manager qui ouvre n'arrête pas l'horloge) ;
--   · seulement les leads « Pending » qui ont un agent (pas Rupture / Produit non
--     reconnu : en pause ; pas Rappel / Non joint : déjà traités) ;
--   · délai dépassé → l'agent actif du même pays qui a le moins de « Pending »,
--     JAMAIS un agent qui a déjà laissé attendre ce lead ; nouvel agent = nouvelle
--     heure ; le passage s'écrit dans historique_affectations, via « delai » ;
--   · aucun autre agent → le lead RESTE chez son agent, rien d'autre (sa décision
--     13/11 : pas de marque « en retard ») ; il partira dès qu'un autre agent existe ;
--   · les leads déjà en attente à l'installation : leur horloge part de
--     l'installation (tenants.reaffectation_depuis) — rien ne bouge à l'instant.
--   · seulement les entreprises actives (une suspendue / archivée ne bouge pas).
--
-- REPRISE D'UNE FONCTION (règle des fichiers, §8) : historiser_affectation
-- (historique_affectations.sql) — un seul ajout : « delai » quand
-- crm.affectation_via = 'delai'. Marquée « fichier: reaffectation_delai.sql » ;
-- historique_affectations.sql la garde (notice « gardée »).
--
--   §1 prérequis ; §2 fuseaux ; §3 réglages par entreprise ; §4 colonnes et horloge
--   du lead ; §5 « Traiter » ; §6 l'historique ; §7 la tâche ; §8 pg_cron ;
--   §9 contrôles ; §10 répétition (annulée).
--
-- RETOUR ARRIÈRE : reaffectation_delai_retour.sql (copie sur le Bureau) — arrête
-- la tâche D'ABORD, puis retire le reste ; l'historique écrit reste.
-- =============================================================================

begin;

-- §1 Prérequis ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.historiser_affectation(text, public.commandes, uuid, uuid, boolean)') is null
     or to_regclass('public.historique_affectations') is null then
    raise exception 'reaffectation_delai.sql : lancez d''abord historique_affectations.sql. Rien n''est installé.';
  end if;
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise exception 'reaffectation_delai.sql : pg_cron n''est pas disponible sur ce projet. Rien n''est installé.';
  end if;
end $$;

-- §2 Le fuseau de chaque pays --------------------------------------------------------
-- GARDE (13/11) : fuseau_du_pays est reprise par fuseaux_pays.sql (liste officielle). Marquée par lui → gardée.
do $garde_fuseaux_1$
begin
  if obj_description(to_regprocedure('public.fuseau_du_pays(text)'), 'pg_proc') = 'fichier: fuseaux_pays.sql' then
    raise notice 'reaffectation_delai.sql : fuseau_du_pays gardée (fuseaux_pays.sql, plus récent). Pas réécrite.';
    return;
  end if;
create or replace function public.fuseau_du_pays(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case upper(btrim(coalesce(p_code, '')))
    when 'AO' then 'Africa/Luanda'      when 'CG' then 'Africa/Brazzaville' when 'CD' then 'Africa/Kinshasa'
    when 'GA' then 'Africa/Libreville'  when 'CM' then 'Africa/Douala'      when 'TD' then 'Africa/Ndjamena'
    when 'NE' then 'Africa/Niamey'      when 'NG' then 'Africa/Lagos'       when 'BJ' then 'Africa/Porto-Novo'
    when 'ML' then 'Africa/Bamako'      when 'SN' then 'Africa/Dakar'       when 'GN' then 'Africa/Conakry'
    when 'CI' then 'Africa/Abidjan'     when 'BF' then 'Africa/Ouagadougou' when 'TG' then 'Africa/Lome'
    when 'GH' then 'Africa/Accra'       when 'MR' then 'Africa/Nouakchott'  when 'MA' then 'Africa/Casablanca'
    when 'MZ' then 'Africa/Maputo'      when 'CF' then 'Africa/Bangui'      when 'GQ' then 'Africa/Malabo'
    else 'UTC'
  end
$$;
revoke all on function public.fuseau_du_pays(text) from public, anon;
grant execute on function public.fuseau_du_pays(text) to authenticated, service_role;
comment on function public.fuseau_du_pays(text) is 'fichier: reaffectation_delai.sql';
end $garde_fuseaux_1$;

alter table public.pays add column if not exists fuseau text;
update public.pays set fuseau = public.fuseau_du_pays(code) where fuseau is null;

-- GARDE (13/11) : pays_fuseau est reprise par fuseaux_pays.sql (liste officielle). Marquée par lui → gardée.
do $garde_fuseaux_2$
begin
  if obj_description(to_regprocedure('public.pays_fuseau()'), 'pg_proc') = 'fichier: fuseaux_pays.sql' then
    raise notice 'reaffectation_delai.sql : pays_fuseau gardée (fuseaux_pays.sql, plus récent). Pas réécrite.';
    return;
  end if;
create or replace function public.pays_fuseau()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.fuseau is null or btrim(new.fuseau) = '' or (tg_op = 'UPDATE' and new.code is distinct from old.code and new.fuseau = old.fuseau) then
    new.fuseau := public.fuseau_du_pays(new.code);
  end if;
  perform now() at time zone new.fuseau;   -- un fuseau inconnu lève une erreur ici
  return new;
end;
$$;
revoke all on function public.pays_fuseau() from public, anon, authenticated;
comment on function public.pays_fuseau() is 'fichier: reaffectation_delai.sql';
end $garde_fuseaux_2$;
drop trigger if exists trg_pays_fuseau on public.pays;
create trigger trg_pays_fuseau before insert or update of code, fuseau on public.pays
  for each row execute function public.pays_fuseau();

-- §3 Les réglages, par entreprise -------------------------------------------------------
alter table public.tenants add column if not exists delai_reaffectation_minutes integer not null default 60;
alter table public.tenants add column if not exists reaffectation_depuis timestamptz not null default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_delai_reaffectation_borne') then
    alter table public.tenants add constraint tenants_delai_reaffectation_borne
      check (delai_reaffectation_minutes between 5 and 480);
  end if;
end $$;

-- Les minutes de travail entre deux instants, à l'heure d'un fuseau :
-- lundi–vendredi 8–18, samedi 8–12, dimanche 0 (60 jours au plus).
create or replace function public.minutes_ouvrees(p_debut timestamptz, p_fin timestamptz, p_fuseau text)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(greatest(0, extract(epoch from (least(f.fin_j, x.fin_l) - greatest(f.deb_j, x.deb_l))) / 60)), 0)::integer
    from (select (greatest(p_debut, p_fin - interval '60 days') at time zone coalesce(p_fuseau, 'UTC')) as deb_l,
                 (p_fin at time zone coalesce(p_fuseau, 'UTC')) as fin_l) x
    cross join lateral generate_series(date_trunc('day', x.deb_l), date_trunc('day', x.fin_l), interval '1 day') j(jour)
    cross join lateral (select j.jour + interval '8 hours' as deb_j,
                               j.jour + case extract(isodow from j.jour)
                                          when 6 then interval '12 hours'
                                          when 7 then interval '8 hours'
                                          else interval '18 hours' end as fin_j) f
   where p_fin > p_debut
$$;
revoke all on function public.minutes_ouvrees(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.minutes_ouvrees(timestamptz, timestamptz, text) to authenticated, service_role;
comment on function public.minutes_ouvrees(timestamptz, timestamptz, text) is 'fichier: reaffectation_delai.sql';

-- Le délai, réglé par l'entreprise (sa décision 13/11) : admin et manager
-- (gere_la_config, comme le reste de Paramètres), et le super admin.
-- tenants ne s'écrit pas depuis le navigateur (super admin seulement) : cette porte.
create or replace function public.fixer_delai_reaffectation(p_tenant uuid, p_minutes integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not (public.is_super_admin() or (p_tenant is not distinct from public.get_my_tenant_id() and public.gere_la_config())) then
    raise exception 'Seuls l''admin et le manager de l''entreprise règlent ce délai.' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then
    raise exception 'Délai de réaffectation : entre 5 et 480 minutes.';
  end if;
  update public.tenants set delai_reaffectation_minutes = p_minutes where id = p_tenant;
  if not found then
    raise exception 'Entreprise introuvable.';
  end if;
  return p_minutes;
end;
$$;
revoke all on function public.fixer_delai_reaffectation(uuid, integer) from public, anon;
grant execute on function public.fixer_delai_reaffectation(uuid, integer) to authenticated, service_role;
comment on function public.fixer_delai_reaffectation(uuid, integer) is 'fichier: reaffectation_delai.sql';

-- §4 L'horloge du lead -----------------------------------------------------------------
alter table public.commandes add column if not exists agent_depuis timestamptz;   -- l'agent actuel l'a depuis
alter table public.commandes add column if not exists ouvert_le    timestamptz;   -- il a cliqué « Traiter »
alter table public.commandes add column if not exists ouvert_par   uuid;

-- Nouvel agent (ou aucun) = horloge remise à zéro. Après tr_auto_affecter_agent
-- (ordre alphabétique : « tr_… » < « trg_… ») : voit l'agent choisi à l'arrivée.
create or replace function public.commande_agent_depuis()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.agent_id is distinct from old.agent_id then
    new.agent_depuis := case when new.agent_id is not null then now() end;
    new.ouvert_le    := null;
    new.ouvert_par   := null;
  end if;
  return new;
end;
$$;
revoke all on function public.commande_agent_depuis() from public, anon, authenticated;
comment on function public.commande_agent_depuis() is 'fichier: reaffectation_delai.sql';
drop trigger if exists trg_zz_agent_depuis on public.commandes;
create trigger trg_zz_agent_depuis before insert or update of agent_id on public.commandes
  for each row execute function public.commande_agent_depuis();

-- §5 « Traiter » : l'agent du lead l'ouvre -----------------------------------------------
create or replace function public.marquer_lead_ouvert(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.commandes c
     set ouvert_le = now(), ouvert_par = auth.uid()
   where c.id = p_id
     and c.ouvert_le is null
     and c.tenant_id = public.get_my_tenant_id()
     and exists (select 1 from public.agents a where a.id = c.agent_id and a.user_id = auth.uid());
  return found;
end;
$$;
revoke all on function public.marquer_lead_ouvert(uuid) from public, anon;
grant execute on function public.marquer_lead_ouvert(uuid) to authenticated, service_role;
comment on function public.marquer_lead_ouvert(uuid) is 'fichier: reaffectation_delai.sql';

-- §6 L'historique : « delai » -----------------------------------------------------------
do $$
declare v_nom text;
begin
  select conname into v_nom from pg_constraint
   where conrelid = 'public.historique_affectations'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%via%';
  if v_nom is not null then
    execute format('alter table public.historique_affectations drop constraint %I', v_nom);
  end if;
  alter table public.historique_affectations add constraint historique_affectations_via_check
    check (via in ('affectation', 'creation', 'automatique', 'navigateur', 'systeme', 'delai'));
end $$;

-- Le corps de historique_affectations.sql (lu le 13/11), plus UNE ligne : « delai ».
create or replace function public.historiser_affectation(
  p_quoi     text,
  p_commande public.commandes,
  p_avant    uuid,
  p_apres    uuid,
  p_creation boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot    uuid := nullif(current_setting('crm.affectation_lot', true), '')::uuid;
  v_acteur uuid := coalesce(auth.uid(), nullif(current_setting('crm.historique_acteur', true), '')::uuid);
  v_via    text;
  v_nom    text;
  v_avant  text;
  v_apres  text;
begin
  -- pg_trigger_depth() vaut ici 1 pour le trigger appelant ; 2 ou plus si
  -- l'écriture vient elle-même d'un trigger (auto_affecter_livreur).
  -- 13/11 (reaffectation_delai.sql) : la tâche des 5 minutes pose crm.affectation_via.
  v_via := case
    when coalesce(current_setting('crm.affectation_via', true), '') = 'delai' then 'delai'
    when v_lot is not null         then 'affectation'
    when p_creation                then 'creation'
    when pg_trigger_depth() > 1    then 'automatique'
    when auth.uid() is not null    then 'navigateur'
    else 'systeme'
  end;

  if v_acteur is not null then
    select coalesce(
             (select nullif(btrim(a.nom), '') from public.agents a
               where a.user_id = v_acteur and a.tenant_id = p_commande.tenant_id limit 1),
             (select nullif(btrim(ur.nom), '') from public.user_roles ur
               where ur.user_id = v_acteur limit 1),
             (select ur.email from public.user_roles ur
               where ur.user_id = v_acteur limit 1))
      into v_nom;
  end if;

  if p_quoi = 'agent' then
    select nullif(btrim(nom), '') into v_avant from public.agents where id = p_avant;
    select nullif(btrim(nom), '') into v_apres from public.agents where id = p_apres;
  else
    select nullif(btrim(nom), '') into v_avant from public.livreurs where id = p_avant;
    select nullif(btrim(nom), '') into v_apres from public.livreurs where id = p_apres;
  end if;

  insert into public.historique_affectations
    (tenant_id, commande_id, vendeur_id,
     commande_lead_id, commande_tracking, commande_client, commande_produit,
     quoi, avant_id, avant_nom, apres_id, apres_nom,
     fait_par, fait_par_nom, via, lot_id)
  values
    (p_commande.tenant_id, p_commande.id, p_commande.vendeur_id,
     p_commande.lead_id, p_commande.tracking_number, p_commande.client_nom, p_commande.produit,
     p_quoi, p_avant, v_avant, p_apres, v_apres,
     v_acteur, v_nom, v_via, v_lot);
end;
$$;
revoke all on function public.historiser_affectation(text, public.commandes, uuid, uuid, boolean)
  from public, anon, authenticated;
comment on function public.historiser_affectation(text, public.commandes, uuid, uuid, boolean)
  is 'fichier: reaffectation_delai.sql';

-- §7 La tâche : tous les leads en retard, en une fois -------------------------------------
create or replace function public.reaffecter_leads_en_retard()
returns table (reaffectes integer, restes integer)
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_nouvel uuid; n_dep integer := 0; n_ret integer := 0;
begin
  perform set_config('crm.affectation_via', 'delai', true);
  for r in
    select c.id, c.tenant_id, c.pays_id, c.agent_id
      from public.commandes c
      join public.tenants t on t.id = c.tenant_id and t.statut = 'actif'
      left join public.pays p on p.id = c.pays_id
     where c.statut_confirmation = 'Pending'
       and c.agent_id is not null
       and c.ouvert_le is null
       and public.minutes_ouvrees(coalesce(c.agent_depuis, greatest(c.created_at, t.reaffectation_depuis)),
                                  now(), coalesce(p.fuseau, 'UTC')) >= t.delai_reaffectation_minutes
     order by coalesce(c.agent_depuis, c.created_at), c.id
     limit 500
     for update of c skip locked
  loop
    -- même règle qu'à l'arrivée (choisir_agent), sans ceux qui l'ont laissé attendre
    select a.id into v_nouvel
      from public.agents a
      join public.user_roles ur on ur.user_id = a.user_id
     where a.tenant_id = r.tenant_id and a.pays_id = r.pays_id and a.actif = true
       and lower(ur.role) = 'agent'
       and a.id <> r.agent_id
       and not exists (select 1 from public.historique_affectations h
                        where h.commande_id = r.id and h.quoi = 'agent' and h.via = 'delai' and h.avant_id = a.id)
     order by (select count(*) from public.commandes c2
                where c2.agent_id = a.id and coalesce(c2.statut_confirmation, 'Pending') = 'Pending'),
              random()
     limit 1;
    if v_nouvel is not null then
      update public.commandes set agent_id = v_nouvel where id = r.id;   -- l'horloge repart (trigger)
      n_dep := n_dep + 1;
    else
      n_ret := n_ret + 1;   -- aucun autre agent : il reste chez le sien
    end if;
  end loop;
  perform set_config('crm.affectation_via', '', true);
  return query select n_dep, n_ret;
end;
$$;
revoke all on function public.reaffecter_leads_en_retard() from public, anon, authenticated;
grant execute on function public.reaffecter_leads_en_retard() to service_role;
comment on function public.reaffecter_leads_en_retard() is 'fichier: reaffectation_delai.sql — lancée par pg_cron toutes les 5 minutes';

-- §8 pg_cron : toutes les 5 minutes (le même nom remplace la tâche, rejouable) ----------
create extension if not exists pg_cron;
select cron.schedule('reaffecter-leads-en-retard', '*/5 * * * *', 'select public.reaffecter_leads_en_retard()');

-- §9 Contrôles ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.pays where fuseau is null) then
    raise exception 'reaffectation_delai.sql : un pays reste sans fuseau. Rien n''est installé.';
  end if;
  if not exists (select 1 from cron.job where jobname = 'reaffecter-leads-en-retard' and schedule = '*/5 * * * *') then
    raise exception 'reaffectation_delai.sql : la tâche pg_cron n''est pas posée. Rien n''est installé.';
  end if;
  if has_function_privilege('authenticated', 'public.reaffecter_leads_en_retard()', 'execute') then
    raise exception 'reaffectation_delai.sql : un compte connecté peut lancer la réaffectation. Rien n''est installé.';
  end if;
end $$;

-- §10 Répétition (annulée) --------------------------------------------------------------
--   l'horloge : samedi 11:30 → lundi 8:30 = 60 minutes de travail ;
--   l'entreprise de test, délai 5 min : un lead vieux de 10 min de travail passe au
--   2e agent (via « delai »), un lead ouvert ne bouge pas, sans 2e agent il reste.
do $$
declare
  c_test constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_pays uuid; v_a uuid; v_b uuid; v_ua uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid; n integer; v_msg text; v_etape text := 'horloge';
  v_lundi timestamptz;
begin
  -- samedi 15/11/2025 11:30 → lundi 17/11/2025 08:30, heure d'Angola
  n := public.minutes_ouvrees(timestamp '2025-11-15 11:30' at time zone 'Africa/Luanda',
                              timestamp '2025-11-17 08:30' at time zone 'Africa/Luanda', 'Africa/Luanda');
  if n <> 60 then raise exception 'reaffectation_delai.sql — horloge : samedi 11:30 → lundi 8:30 = % minutes (attendu 60). Rien n''est installé.', n; end if;
  n := public.minutes_ouvrees(timestamp '2025-11-17 17:30' at time zone 'Africa/Luanda',
                              timestamp '2025-11-18 09:00' at time zone 'Africa/Luanda', 'Africa/Luanda');
  if n <> 90 then raise exception 'reaffectation_delai.sql — horloge : lundi 17:30 → mardi 9:00 = % minutes (attendu 90). Rien n''est installé.', n; end if;

  if not exists (select 1 from public.tenants where id = c_test) then
    raise notice 'reaffectation_delai.sql : pas d''entreprise de test — répétition des leads sautée.'; return;
  end if;
  select a.id, a.pays_id, a.user_id into v_a, v_pays, v_ua from public.agents a
    join public.user_roles ur on ur.user_id = a.user_id
   where a.tenant_id = c_test and a.actif and lower(ur.role) = 'agent' limit 1;
  if v_a is null then
    raise notice 'reaffectation_delai.sql : l''entreprise de test n''a pas d''agent — répétition des leads sautée.'; return;
  end if;

  begin
    v_etape := 'préparation';
    update public.tenants set delai_reaffectation_minutes = 5 where id = c_test;   -- (annulé avec le reste)
    -- un lundi 10:00 au fuseau du pays : 10 minutes de travail écoulées
    v_lundi := (date_trunc('week', now() at time zone (select fuseau from public.pays where id = v_pays)) - interval '7 days' + interval '10 hours')
               at time zone (select fuseau from public.pays where id = v_pays);

    v_etape := 'sans 2e agent : le lead reste chez son agent';
    -- les autres agents du pays sont mis de côté le temps de la répétition
    update public.agents set actif = false where tenant_id = c_test and pays_id = v_pays and id <> v_a;
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, prix, pays_id, agent_id, ville_zone, adresse)
    values (c_test, 'REPETITION-T21-1', 'Répétition 1', '+244900000011', 'répétition', 0, v_pays, v_a, 'Luanda', 'rue')
    returning id into v_l1;
    -- produit inconnu → « Produit non reconnu » à l'arrivée ; remis « Pending » comme le fait liberer_ruptures
    perform set_config('crm.liberation_rupture', 'oui', true);
    update public.commandes set agent_depuis = v_lundi - interval '10 minutes', statut_confirmation = 'Pending' where id = v_l1;
    perform set_config('crm.liberation_rupture', '', true);
    perform public.reaffecter_leads_en_retard();
    if (select agent_id from public.commandes where id = v_l1) <> v_a then
      raise exception 'sans 2e agent : le lead devait rester chez son agent';
    end if;

    v_etape := 'un 2e agent : le lead passe, via « delai »';
    insert into public.agents (tenant_id, nom, user_id, pays_id, actif)
    values (c_test, 'Répétition B', v_ua, v_pays, true) returning id into v_b;
    perform public.reaffecter_leads_en_retard();
    if (select agent_id from public.commandes where id = v_l1) <> v_b then
      raise exception 'le lead n''est pas passé au 2e agent';
    end if;
    if not exists (select 1 from public.historique_affectations where commande_id = v_l1 and via = 'delai'
                    and avant_id = v_a and apres_id = v_b) then
      raise exception 'le passage n''est pas dans l''historique (via delai)';
    end if;
    if (select agent_depuis from public.commandes where id = v_l1) < now() - interval '1 minute' then
      raise exception 'le nouvel agent n''a pas une horloge neuve';
    end if;

    v_etape := 'un lead ouvert ne bouge pas';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, prix, pays_id, agent_id, ville_zone, adresse)
    values (c_test, 'REPETITION-T21-2', 'Répétition 2', '+244900000012', 'répétition', 0, v_pays, v_a, 'Luanda', 'rue')
    returning id into v_l2;
    -- produit inconnu → « Produit non reconnu » à l'arrivée ; remis « Pending » comme le fait liberer_ruptures
    perform set_config('crm.liberation_rupture', 'oui', true);
    update public.commandes set agent_depuis = v_lundi - interval '10 minutes', statut_confirmation = 'Pending' where id = v_l2;
    perform set_config('crm.liberation_rupture', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    if not public.marquer_lead_ouvert(v_l2) then raise exception '« Traiter » n''a pas marqué le lead'; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform public.reaffecter_leads_en_retard();
    if (select agent_id from public.commandes where id = v_l2) <> v_a then
      raise exception 'un lead ouvert a été déplacé';
    end if;

    v_etape := 'il ne revient jamais à un agent qui l''a laissé attendre';
    update public.commandes set agent_depuis = v_lundi - interval '10 minutes' where id = v_l1;
    perform public.reaffecter_leads_en_retard();
    if (select agent_id from public.commandes where id = v_l1) <> v_b then
      raise exception 'le lead est revenu à l''agent qui l''avait laissé attendre';
    end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('crm.affectation_via', '', true);
    if v_msg <> 'REPETITION_OK' then
      raise exception 'reaffectation_delai.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'reaffectation_delai.sql : réaffectation après % min de travail (lun–ven 8–18, sam 8–12, heure du pays), toutes les 5 minutes. Répétition annulée.',
    (select delai_reaffectation_minutes from public.tenants where id = c_test);
end $$;

commit;

-- Ce qui est en place
select (select string_agg(p.nom || ' → ' || p.fuseau, ', ' order by p.nom) from public.pays p) as fuseaux,
       (select string_agg(t.nom_entreprise || ' : ' || t.delai_reaffectation_minutes || ' min', ', ') from public.tenants t) as delais,
       (select schedule from cron.job where jobname = 'reaffecter-leads-en-retard') as tache;
