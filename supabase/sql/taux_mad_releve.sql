-- =============================================================================
-- L'ÉQUIVALENT EN MAD D'UN RELEVÉ — 11/11/2026 (P8, CRM_seller_payment_rules.docx §4 :
-- « Equivalent in MAD optional, with a rate entered by hand on the invoice »)
-- NE MODIFIE AUCUN MONTANT. Ajoute une colonne et une porte.
-- =============================================================================
--
--   · reglements.taux_mad : combien de MAD pour 1 unité de la devise du relevé
--     (ex. 0,0105 MAD pour 1 AOA). Vide = pas d'équivalent (facultatif).
--   · L'équivalent = « à payer » × taux, calculé à l'affichage : il suit donc
--     tout changement d'« à payer » (ajustement, crédit, transfert) sans rien
--     recalculer.
--   · fixer_taux_mad(relevé, taux) : manager / admin (gerer_reglements) de
--     l'entreprise ou super admin ; taux > 0, ou vide pour l'enlever.
--   · SA DÉCISION (11/11) : le taux reste modifiable APRÈS « payé » — l'équivalent
--     MAD est pour information, il ne change aucun montant. reglements_garde
--     (reglement_atomique.sql, 11/11) laisse passer taux_mad seul sur un relevé payé.
--
-- RETOUR ARRIÈRE : taux_mad_releve_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.releve_modifiable(uuid)') is null then
    raise exception 'taux_mad_releve.sql : lancez d''abord retenues_releve.sql (releve_modifiable). Rien n''est installé.';
  end if;
end $$;

alter table public.reglements add column if not exists taux_mad numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reglements_taux_mad_positif') then
    alter table public.reglements add constraint reglements_taux_mad_positif check (taux_mad is null or taux_mad > 0);
  end if;
end $$;

create or replace function public.fixer_taux_mad(p_reglement uuid, p_taux numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare r public.reglements%rowtype;
begin
  -- Payé ou non (sa décision 11/11 : l'équivalent MAD est pour information, il ne
  -- change aucun montant). Les droits : ceux d'un relevé.
  select * into r from public.reglements where id = p_reglement for update;
  if not found then
    raise exception 'Relevé introuvable.';
  end if;
  if not (public.is_super_admin()
          or (r.tenant_id = public.get_my_tenant_id() and public.a_la_permission('gerer_reglements'))) then
    raise exception 'Votre rôle ne permet pas de modifier un relevé.' using errcode = '42501';
  end if;
  if p_taux is not null and p_taux <= 0 then
    raise exception 'Le taux MAD doit être plus grand que 0 (ou vide pour l''enlever).' using errcode = 'check_violation';
  end if;
  update public.reglements set taux_mad = p_taux where id = r.id;
  return case when p_taux is null then null else round(r.net_a_payer * p_taux, 2) end;
end;
$$;
revoke all on function public.fixer_taux_mad(uuid, numeric) from public, anon;
grant execute on function public.fixer_taux_mad(uuid, numeric) to authenticated, service_role;
comment on function public.fixer_taux_mad(uuid, numeric) is 'fichier: taux_mad_releve.sql';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reglements' and column_name = 'taux_mad') then
    raise exception 'taux_mad_releve.sql : la colonne taux_mad manque. Rien n''est installé.';
  end if;
  raise notice 'taux_mad_releve.sql : taux MAD saisissable sur un relevé non payé ; équivalent = à payer × taux. Aucun montant modifié.';
end $$;

commit;
