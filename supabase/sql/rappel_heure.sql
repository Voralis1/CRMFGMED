-- =============================================================================
-- L'heure du rappel — 27/10/2026
-- =============================================================================
--
-- appels.date_rappel était un type DATE : l'heure choisie par l'agent était
-- JETÉE à l'enregistrement, seul le jour restait. Elle devient timestamptz,
-- comme commandes.date_rappel.
--
-- Les lignes existantes (2 le 27/10, rien ne les lit) gardent leur jour, à
-- minuit UTC : on ne réinvente pas une heure qui n'a jamais été gardée.
--
-- Et un index pour la file de l'agent, qui trie et filtre les rappels sur
-- commandes.date_rappel.
--
-- Rien d'autre ne dépend de la colonne (aucune vue, aucune fonction, lu le
-- 27/10). Exécutable en entier, et deux fois.
-- =============================================================================

do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'appels' and column_name = 'date_rappel') = 'date' then
    alter table public.appels
      alter column date_rappel type timestamptz using (date_rappel::timestamp at time zone 'UTC');
    raise notice 'appels.date_rappel : date → timestamptz.';
  end if;
end $$;

create index if not exists idx_commandes_date_rappel
  on public.commandes (tenant_id, date_rappel) where date_rappel is not null;

-- Vérification
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'appels' and column_name = 'date_rappel')
     <> 'timestamp with time zone' then
    raise exception 'appels.date_rappel n''est pas timestamptz.';
  end if;
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'commandes' and column_name = 'date_rappel')
     <> 'timestamp with time zone' then
    raise exception 'commandes.date_rappel n''est pas timestamptz.';
  end if;
end $$;

select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and column_name = 'date_rappel'
 order by 1;
