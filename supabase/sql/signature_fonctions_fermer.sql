  -- =====================================================================
  -- FERMER LES CINQ FONCTIONS DE SIGNATURE — 23/10/2026
  -- Un seul fichier. Ne modifie aucune donnée. Rejouable.
  -- =====================================================================
  --
  -- La signature HMAC a été retirée du produit le 20/10 (écran, vérification,
  -- tout). Cinq fonctions sont restées appelables :
  --   reveler_secret_source(uuid, text)     teste un MOT DE PASSE et dit s'il
  --                                         est bon (limité, journalisé, réservé
  --                                         à qui gère la source — mais ne sert
  --                                         plus à rien : personne ne lit ce secret)
  --   regenerer_secret_source(uuid)
  --   definir_secret_source(uuid, text)
  --   regler_signature_source(uuid, text)
  --   noter_echec_signature(uuid)
  -- Une porte que personne n'utilise et qui peut tester des mots de passe se
  -- ferme.
  --
  -- On RETIRE le droit d'exécuter, on ne supprime PAS : la signature est mise
  -- de côté, pas abandonnée, et ces corps sont la seule copie de cette logique.
  --
  -- Vérifié avant d'écrire ce fichier (23/10, lecture seule) : rien ne les
  -- appelle — ni l'app, ni les Edge Functions (arbre de travail ET main), ni
  -- une autre fonction SQL, ni un trigger, une vue, une policy ou un job cron.
  --
  -- Qui peut encore les exécuter après ce fichier : postgres (leur
  -- propriétaire, donc l'éditeur SQL) et supabase_admin (superutilisateur).
  -- On ne peut pas retirer un droit à un propriétaire ni à un superutilisateur.
  --
  -- POUR RALLUMER LA SIGNATURE : signature_fonctions_rouvrir.sql (remet
  -- exactement les droits du 23/10 avant ce fichier). Rien d'autre.
  -- ⚠ secret_signature_source.sql les rouvre aussi s'il est relancé (il est
  -- mis de côté : ne pas le relancer). identifiants_api.sql, lui, ne les
  -- rouvre plus depuis le 23/10.
  -- =====================================================================

  revoke execute on function public.reveler_secret_source(uuid, text)   from public, anon, authenticated, service_role;
  revoke execute on function public.regenerer_secret_source(uuid)       from public, anon, authenticated, service_role;
  revoke execute on function public.definir_secret_source(uuid, text)   from public, anon, authenticated, service_role;
  revoke execute on function public.regler_signature_source(uuid, text) from public, anon, authenticated, service_role;
  revoke execute on function public.noter_echec_signature(uuid)         from public, anon, authenticated, service_role;


  -- ---------------------------------------------------------------------
  -- Vérification : LÈVE si l'une des cinq manque (elle ne doit pas avoir été
  -- supprimée) ou si un rôle peut encore l'exécuter.
  -- Tous les rôles de la base sont testés (has_function_privilege compte
  -- PUBLIC et les appartenances de rôle), sauf ceux qui ne peuvent pas perdre
  -- ce droit : le propriétaire, ceux qui en héritent, les superutilisateurs.
  -- ---------------------------------------------------------------------
  do $$
  declare
    v_sig    text;
    v_fn     regprocedure;
    v_owner  oid;
    v_role   record;
    v_ouvert text[] := '{}';
  begin
    foreach v_sig in array array[
      'public.reveler_secret_source(uuid,text)',
      'public.regenerer_secret_source(uuid)',
      'public.definir_secret_source(uuid,text)',
      'public.regler_signature_source(uuid,text)',
      'public.noter_echec_signature(uuid)'
    ] loop
      v_fn := to_regprocedure(v_sig);
      if v_fn is null then
        raise exception 'Fonction absente : %. Elle devait être fermée, pas supprimée.', v_sig;
      end if;
      select proowner into v_owner from pg_proc where oid = v_fn;

      for v_role in
        select r.oid, r.rolname
          from pg_roles r
        where not r.rolsuper
          and r.oid <> v_owner
          and not pg_has_role(r.oid, v_owner, 'USAGE')
      loop
        if has_function_privilege(v_role.oid, v_fn, 'EXECUTE') then
          v_ouvert := v_ouvert || (v_role.rolname || ' → ' || v_sig);
        end if;
      end loop;
    end loop;

    if cardinality(v_ouvert) > 0 then
      raise exception 'Encore exécutable : %', array_to_string(v_ouvert, ' ; ');
    end if;
    raise notice 'Les cinq fonctions de signature sont fermées à tous les rôles (sauf propriétaire et superutilisateur).';
  end $$;
