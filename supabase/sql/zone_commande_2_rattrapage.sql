-- =====================================================================
-- ATTENTION — CE FICHIER MODIFIE DES COMMANDES EXISTANTES.
-- RATTRAPAGE DE LA ZONE DES COMMANDES — FICHIER 2 SUR 2 — 27/10/2026
-- À LANCER SEULEMENT APRÈS zone_commande.sql, ET QUAND ON LE DÉCIDE.
-- =====================================================================
--
-- Chaque commande SANS ZONE et PAS ENCORE PARTIE reçoit la zone de son pays
-- dont le nom est égal à sa ville (même règle que le trigger :
-- zone_de_commande). Rien d'autre n'est écrit : ni la ville, ni le pays, ni
-- l'entrepôt, ni le livreur. Aucune zone n'est créée.
--
-- Pas touchées :
--   · les commandes qui ont déjà une zone (choisie par l'agent ou non) ;
--   · les commandes déjà parties (commande_expediee) ;
--   · celles dont la ville ne correspond à aucune zone, ou à plusieurs.
--
-- Aucune prévision ici : le résultat dit ce qui a été FAIT, une ligne par
-- entreprise / pays / résultat / zone. Une commande que la base refuse
-- (contrôle d'une autre règle) n'arrête pas les autres : elle apparaît avec
-- le message du refus, et elle reste sans zone.
--
-- Rejouable : au second passage, les commandes remplies au premier
-- apparaissent dans « déjà une zone », et rien ne change.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.zone_de_commande(uuid,uuid,text)') is null then
    raise exception 'Lancez d''abord zone_commande.sql (fichier 1) : la règle n''est pas en place.';
  end if;
end $$;

create or replace function public.remplir_zones_commandes()
returns table (entreprise text, pays text, resultat text, zone text, commandes bigint)
language plpgsql
set search_path = public
as $$
declare
  r        record;
  v_zone   uuid;
  v_nb     integer;
  v_issue  text;
  v_nom    text;
begin
  create temp table if not exists _zones_rattrapage (
    tenant_id uuid, pays_id uuid, resultat text, zone text
  ) on commit drop;
  truncate _zones_rattrapage;

  -- Pour le compte rendu : celles qui avaient déjà une zone.
  insert into _zones_rattrapage
  select c.tenant_id, c.pays_id, '0. déjà une zone, non touchée', null
    from public.commandes c
   where c.zone_id is not null;

  for r in select c.id, c.tenant_id, c.pays_id, c.ville_zone
             from public.commandes c
            where c.zone_id is null
            order by c.created_at
  loop
    v_zone := null;
    v_nom  := null;
    select count(*) into v_nb
      from public.zones z
     where z.tenant_id = r.tenant_id and z.pays_id = r.pays_id
       and public.texte_normalise(z.nom_zone) = public.texte_normalise(r.ville_zone);

    if v_nb = 0 then
      v_issue := '3. laissée vide : aucune zone de ce nom dans ce pays';
    elsif v_nb > 1 then
      v_issue := '4. laissée vide : plusieurs zones de ce nom dans ce pays';
    elsif public.commande_expediee(r.id) then
      v_issue := '2. laissée vide : déjà partie (une zone correspondait)';
    else
      v_zone := public.zone_de_commande(r.tenant_id, r.pays_id, r.ville_zone);
      select z.nom_zone into v_nom from public.zones z where z.id = v_zone;
      begin
        update public.commandes set zone_id = v_zone where id = r.id and zone_id is null;
        v_issue := '1. zone remplie';
      exception when others then
        v_issue := '5. refusée par la base : ' || sqlerrm;
      end;
    end if;

    insert into _zones_rattrapage values (r.tenant_id, r.pays_id, v_issue, v_nom);
  end loop;

  return query
    select coalesce(t.nom_entreprise, x.tenant_id::text), p.nom, x.resultat, x.zone, count(*)
      from _zones_rattrapage x
      left join public.tenants t on t.id = x.tenant_id
      left join public.pays    p on p.id = x.pays_id
     group by 1, 2, 3, 4
     order by 1, 2, 3, 4;
end;
$$;

revoke all on function public.remplir_zones_commandes() from public, anon, authenticated, service_role;

-- Le résultat : ce qui a été fait.
select * from public.remplir_zones_commandes();
