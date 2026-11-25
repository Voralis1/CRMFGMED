-- =============================================================================
-- RETOUR ARRIÈRE de fuseaux_pays.sql — 13/11/2026
-- Remet fuseau_du_pays et pays_fuseau de reaffectation_delai.sql (22 pays à la main,
-- sinon UTC) et retire fuseaux_du_pays. Les pays déjà créés gardent leur fuseau. Rejouable.
-- =============================================================================
begin;
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
drop function if exists public.fuseaux_du_pays(text);
do $$ begin
  raise notice 'fuseaux_pays_retour.sql : liste de reaffectation_delai.sql remise (22 pays, sinon UTC).';
end $$;
commit;
