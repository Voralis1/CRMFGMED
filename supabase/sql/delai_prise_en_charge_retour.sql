-- =============================================================================
-- RETOUR ARRIÈRE de delai_prise_en_charge.sql — 02/11/2026
-- =============================================================================
-- Remet est_tentative EXACTEMENT comme lue en production le 02/11 (corps de
-- commandes_statut_lot.sql, md5 vérifié à la fin) avec la marque de ce
-- fichier, puis retire delai_prise_en_charge, resume_delais,
-- est_prise_en_charge. Aucune donnée touchée. Rejouable.
-- Les pages qui appellent delai_prise_en_charge afficheront « indisponible ».
-- =============================================================================

create or replace function public.est_tentative(p_tenant uuid, p_statut text, p_lot uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $function$
  select p_lot is null
     and p_statut is not null and p_statut <> 'Pending'
     and public.est_statut_ouvert(p_tenant, p_statut)
$function$;
comment on function public.est_tentative(uuid, text, uuid) is 'fichier: commandes_statut_lot.sql';
revoke all on function public.est_tentative(uuid, text, uuid) from public, anon;
grant execute on function public.est_tentative(uuid, text, uuid) to authenticated, service_role;

drop function if exists public.delai_prise_en_charge(uuid, timestamptz, timestamptz);
drop function if exists public.resume_delais(numeric[]);
drop function if exists public.est_prise_en_charge(text, uuid);

do $$
declare v_md5 text;
begin
  select md5(prosrc) into v_md5 from pg_proc where oid = 'public.est_tentative(uuid, text, uuid)'::regprocedure;
  if v_md5 is distinct from '90fc46af8a39c154bd0a2751fb5f55dd' then
    raise exception 'Retour : est_tentative n''est pas exactement celle d''avant (md5 %). Rien n''a été fait.', v_md5;
  end if;
  raise notice 'Retour fait : est_tentative identique à celle d''avant (md5 vérifié), mesure retirée.';
end $$;
