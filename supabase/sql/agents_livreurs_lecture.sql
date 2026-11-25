-- =============================================================================
-- agents / livreurs : un vendeur et un livreur ne lisent que LEUR fiche
-- 30/10/2026
-- =============================================================================
--
-- LE TROU : `agents` et `livreurs` se lisaient par toute l'entreprise
-- (lecture_agents / lecture_livreurs : tenant_id = la mienne). Un livreur
-- pouvait lire, depuis la console du navigateur, la liste des agents et celle
-- des livreurs AVEC LEURS TÉLÉPHONES ; un vendeur aussi (noté dans CLAUDE.md
-- depuis le 12/10). La page Paiements, ouverte par un livreur en tapant
-- l'adresse, chargeait cette liste avant de le renvoyer (corrigé côté page le
-- 30/10 ; ici, c'est la base qui ferme).
--
-- LA RÈGLE (SELECT seulement) :
--   · vendeur, livreur : SA fiche (user_id = lui), rien d'autre ;
--   · tous les autres rôles de l'entreprise : comme avant (toute l'entreprise) ;
--   · super_admin : tout.
-- Les écritures (agents_update / livreurs_update) ne changent pas.
--
-- CE QUI NE CASSE PAS (lu dans le code et la base le 30/10) :
--   · les pages du livreur lisent SA fiche (nom, id) : Livraisons, l'en-tête ;
--     v_caisses_livreur (security_invoker) lit SA ligne ;
--   · ce qui choisit un agent ou un livreur tourne avec les droits du
--     propriétaire (choisir_agent, livreur_pour_commande, mon_agent_id,
--     mon_livreur_id, est_ma_livraison, les affectations par lot…) : inchangé ;
--   · check_livraison_coherente (droits de l'appelant) n'est jamais appelé par
--     un vendeur ou un livreur (livraisons écrites par la clé service ou par
--     des fonctions propriétaires) ;
--   · stats_dashboard (droits de l'appelant) : pour un vendeur, les noms
--     d'agents disparaissent — l'écran les cachait déjà.
-- CE QUI CHANGE À L'ÉCRAN : Commandes, vendeur : plus de colonne « Agent
-- Assigné » dans l'export ni de ligne « Agent » dans le tiroir (la page du
-- 30/10 les retire — sinon elles diraient « Non assigné », ce qui est faux).
--
-- §1 arrêt si une politique FOR ALL existe (elle donnerait aussi la lecture ;
-- la retirer retirerait des écritures : à trancher à la main) ; §2 les
-- politiques de lecture remplacées (TOUTES celles de lecture retirées
-- d'abord : elles s'additionnent) ; §3 vérification ; §4 répétition sous les
-- droits d'un vendeur, d'un livreur et d'un manager, annulée.
-- Retour arrière : agents_livreurs_lecture_retour.sql (les politiques
-- d'avant, mot pour mot). Exécutable en entier, et deux fois.
-- =============================================================================

do $$
declare v_p text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into v_p
    from pg_policies where schemaname = 'public' and tablename in ('agents', 'livreurs') and cmd = 'ALL';
  if v_p is not null then
    raise exception 'Politique FOR ALL sur agents/livreurs (%) : elle donnerait la lecture à tous. À trancher à la main. Rien n''a été installé.', v_p;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Les politiques de lecture
-- -----------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
            where schemaname = 'public' and tablename in ('agents', 'livreurs') and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy lecture_agents on public.agents
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (lower(coalesce(public.mon_role(), '')) not in ('seller', 'livreur')
             or user_id = auth.uid()))
  );

create policy lecture_livreurs on public.livreurs
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (lower(coalesce(public.mon_role(), '')) not in ('seller', 'livreur')
             or user_id = auth.uid()))
  );


-- -----------------------------------------------------------------------------
-- 3. Vérification
-- -----------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename in ('agents', 'livreurs') and cmd in ('SELECT', 'ALL');
  if v_n <> 2 then
    raise exception 'agents/livreurs : % politique(s) de lecture au lieu de 2.', v_n;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('agents', 'livreurs')
              and cmd = 'SELECT' and (qual not like '%seller%' or qual not like '%livreur%' or qual not like '%auth.uid()%')) then
    raise exception 'agents/livreurs : une politique de lecture n''a pas la règle vendeur/livreur.';
  end if;
  raise notice 'agents_livreurs_lecture.sql : en place.';
end $$;


-- -----------------------------------------------------------------------------
-- 4. Répétition : lire SOUS LES DROITS d'un vendeur, d'un livreur, d'un
--    manager (compte posé comme le fait l'app, rôle « authenticated »).
--    Tout est annulé à la fin.
-- -----------------------------------------------------------------------------
do $$
declare
  v_t      uuid;
  v_vend   uuid;
  v_liv    uuid;
  v_resp   uuid;
  v_n      integer;
  v_tot_a  integer;
  v_tot_l  integer;
  v_a_moi  integer;
  v_msg    text;
begin
  -- Une entreprise qui a un vendeur, un livreur avec un compte, et un manager/admin.
  select l.tenant_id, l.user_id into v_t, v_liv from public.livreurs l
   where l.user_id is not null
     and exists (select 1 from public.user_roles ur where ur.tenant_id = l.tenant_id and ur.role = 'seller')
     and exists (select 1 from public.user_roles ur where ur.tenant_id = l.tenant_id and ur.role in ('admin', 'manager'))
   order by (l.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, l.tenant_id limit 1;
  if v_t is null then
    raise notice 'Répétition sautée : aucune entreprise avec un vendeur, un livreur (compte) et un manager.';
    return;
  end if;
  select user_id into v_vend from public.user_roles where tenant_id = v_t and role = 'seller' order by user_id limit 1;
  select user_id into v_resp from public.user_roles where tenant_id = v_t and role in ('admin', 'manager') order by user_id limit 1;
  select count(*) into v_tot_a from public.agents where tenant_id = v_t;
  select count(*) into v_tot_l from public.livreurs where tenant_id = v_t;

  begin
    -- le livreur
    perform set_config('request.jwt.claims', json_build_object('sub', v_liv, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.livreurs;
    if v_n <> 1 then raise exception 'livreur : % livreur(s) lisible(s) au lieu de 1 (le sien)', v_n; end if;
    if not exists (select 1 from public.livreurs where user_id = v_liv) then raise exception 'livreur : sa propre fiche n''est plus lisible'; end if;
    select count(*) into v_n from public.agents;
    execute 'reset role';
    select count(*) into v_a_moi from public.agents where user_id = v_liv;
    if v_n <> v_a_moi then raise exception 'livreur : % agent(s) lisible(s) au lieu de %', v_n, v_a_moi; end if;

    -- le vendeur
    perform set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.livreurs;
    if v_n <> 0 then raise exception 'vendeur : % livreur(s) lisible(s) au lieu de 0', v_n; end if;
    select count(*) into v_n from public.agents;
    if v_n <> 0 then raise exception 'vendeur : % agent(s) lisible(s) au lieu de 0', v_n; end if;
    execute 'reset role';

    -- le manager : comme avant
    perform set_config('request.jwt.claims', json_build_object('sub', v_resp, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.agents;
    if v_n <> v_tot_a then raise exception 'manager : % agent(s) au lieu de %', v_n, v_tot_a; end if;
    select count(*) into v_n from public.livreurs;
    if v_n <> v_tot_l then raise exception 'manager : % livreur(s) au lieu de %', v_n, v_tot_l; end if;
    execute 'reset role';

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'agents_livreurs_lecture.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;
  raise notice 'agents_livreurs_lecture.sql : répétition réussie (livreur : sa fiche seule ; vendeur : rien ; manager : comme avant), tout annulé.';
end $$;
