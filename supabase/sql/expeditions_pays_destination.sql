-- =============================================================================
-- Le pays de destination d'une expédition ne se perd plus — 30/10/2026
-- =============================================================================
--
-- LE TROU : un responsable qui modifiait une expédition choisit un ENTREPÔT ;
-- son enregistrement écrivait pays_destination_id = NULL. L'écran du vendeur
-- lit le PAYS : la destination disparaissait de chez lui. Lu le 30/10 : 1
-- expédition sur 6 — EXP-000031 (entreprise de test), approuvée puis modifiée,
-- reçue en Angola (le stock est juste, seul le pays manque).
--
-- LA RÈGLE (un entrepôt = un pays, idx_entrepots_un_par_pays) :
--   · un entrepôt de destination posé → le pays de destination est le sien ;
--   · le pays de destination ne redevient jamais NULL une fois posé ;
--   · tout chemin : la page (corrigée aussi), la console, l'éditeur SQL.
-- Le pays se DÉDUIT de l'entrepôt : ce n'est pas une réparation silencieuse
-- d'une valeur fausse, c'est la même information écrite deux fois.
--
-- §1 prérequis ; §2 le trigger ; §3 le rattrapage (SEULE écriture sur des
-- expéditions existantes : pays_destination_id, là où il est NULL) ;
-- §4 vérification ; §5 répétition (annulée).
-- Retour arrière : expeditions_pays_destination_retour.sql (retire le
-- trigger ; le pays rattrapé reste, il est juste).
-- Exécutable en entier, et deux fois.
-- =============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'expeditions' and column_name = 'pays_destination_id') then
    raise exception 'expeditions.pays_destination_id manque. Rien n''a été installé.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Le trigger
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER : le vendeur ne lit pas `entrepots`.
create or replace function public.expedition_pays_destination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pays uuid;
begin
  if new.entrepot_destination_id is not null then
    select e.pays_id into v_pays from public.entrepots e where e.id = new.entrepot_destination_id;
    if v_pays is not null then
      new.pays_destination_id := v_pays;
    end if;
  end if;
  if new.pays_destination_id is null and tg_op = 'UPDATE' and old.pays_destination_id is not null then
    new.pays_destination_id := old.pays_destination_id;
  end if;
  return new;
end;
$$;
revoke all on function public.expedition_pays_destination() from public, anon, authenticated;

-- « zz » : après tr_expeditions_garde et tr_expedition_reception_figee.
create or replace trigger trg_zz_expedition_pays_destination
  before insert or update of entrepot_destination_id, pays_destination_id on public.expeditions
  for each row execute function public.expedition_pays_destination();


-- -----------------------------------------------------------------------------
-- 3. Le rattrapage : le pays de l'entrepôt de destination, sinon de réception
-- -----------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  update public.expeditions x
     set pays_destination_id = e.pays_id
    from public.entrepots e
   where x.pays_destination_id is null
     and e.id = coalesce(x.entrepot_destination_id, x.entrepot_reception_id)
     and e.pays_id is not null;
  get diagnostics v_n = row_count;
  raise notice 'expeditions_pays_destination.sql : pays de destination rempli sur % expédition(s).', v_n;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Vérification
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_zz_expedition_pays_destination' and tgenabled <> 'D') then
    raise exception 'trg_zz_expedition_pays_destination absent ou désactivé.';
  end if;
  raise notice 'expeditions_pays_destination.sql : en place.';
end $$;


-- -----------------------------------------------------------------------------
-- 5. Répétition : une expédition avec un pays, puis l'enregistrement d'un
--    responsable qui envoie NULL et un entrepôt ; le pays doit rester celui
--    de l'entrepôt. Puis NULL seul : le pays reste. Tout est annulé.
-- -----------------------------------------------------------------------------
do $$
declare
  v_ent public.entrepots;
  v_x   uuid;
  v_msg text;
begin
  select * into v_ent from public.entrepots where pays_id is not null
   order by (tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, tenant_id limit 1;
  if v_ent.id is null then raise notice 'Répétition sautée : aucun entrepôt avec un pays.'; return; end if;
  begin
    insert into public.expeditions (tenant_id, pays, pays_destination_id, statut)
    values (v_ent.tenant_id, 'Répétition', v_ent.pays_id, 'en_attente') returning id into v_x;
    update public.expeditions set entrepot_destination_id = v_ent.id, pays_destination_id = null where id = v_x;
    if (select pays_destination_id from public.expeditions where id = v_x) is distinct from v_ent.pays_id then
      raise exception 'entrepôt + NULL : le pays n''est pas celui de l''entrepôt';
    end if;
    update public.expeditions set entrepot_destination_id = null, pays_destination_id = null where id = v_x;
    if (select pays_destination_id from public.expeditions where id = v_x) is distinct from v_ent.pays_id then
      raise exception 'NULL seul : le pays a été effacé';
    end if;
    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'expeditions_pays_destination.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;
  raise notice 'expeditions_pays_destination.sql : répétition réussie, tout annulé.';
end $$;

select reference, (select nom from public.pays where id = pays_destination_id) as pays_destination
  from public.expeditions order by created_at desc;
