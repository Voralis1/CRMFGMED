-- =============================================================================
-- RETOUR ARRIÈRE de anon_aucun_droit.sql — 02/11/2026
-- =============================================================================
-- Remet CHAQUE objet de public (relation, colonne, fonction), les droits par
-- défaut et l'option de v_pays_livrables EXACTEMENT comme dans la photo
-- ci-dessous (lue le 02/11/2026, la même que celle du fichier aller), puis le
-- VÉRIFIE objet par objet ; une seule différence → le retour s'annule en
-- entier et le dit. « Exactement » = les mêmes entrées dans chaque liste de
-- droits (l'ordre des entrées n'a pas de sens : un droit redonné s'ajoute en
-- fin de liste). Une collée, rejouable. Aucune donnée touchée.
-- ⚠ Remet anon dans l'état d'avant : tous ses droits reviennent.
-- =============================================================================

-- ===== LITTÉRAUX : les droits lus le 02/11/2026 (42 relations, 35 colonnes,
--       128 fonctions, 6 droits par défaut, 1 option de vue) =====
drop table if exists pg_temp._acl_lu;
create temp table _acl_lu (quoi text, objet text, acl text);
insert into _acl_lu (quoi, objet, acl) values
  ('col', 'sources_import.actif', 'authenticated=r/postgres'),
  ('col', 'sources_import.created_at', 'authenticated=r/postgres'),
  ('col', 'sources_import.created_by', 'authenticated=r/postgres'),
  ('col', 'sources_import.dernier_modified_time', 'authenticated=r/postgres'),
  ('col', 'sources_import.derniere_erreur', 'authenticated=r/postgres'),
  ('col', 'sources_import.derniere_sync', 'authenticated=r/postgres'),
  ('col', 'sources_import.id', 'authenticated=r/postgres'),
  ('col', 'sources_import.jeton_regenere_le', 'authenticated=r/postgres'),
  ('col', 'sources_import.jeton_regenere_par', 'authenticated=r/postgres'),
  ('col', 'sources_import.limite_appels_minute', 'authenticated=r/postgres'),
  ('col', 'sources_import.limite_leads_minute', 'authenticated=r/postgres'),
  ('col', 'sources_import.mapping', 'authenticated=r/postgres'),
  ('col', 'sources_import.nb_importees', 'authenticated=r/postgres'),
  ('col', 'sources_import.nb_rejetees', 'authenticated=r/postgres'),
  ('col', 'sources_import.nom', 'authenticated=r/postgres'),
  ('col', 'sources_import.onglet', 'authenticated=r/postgres'),
  ('col', 'sources_import.pays_defaut', 'authenticated=r/postgres'),
  ('col', 'sources_import.prefixe_lead', 'authenticated=r/postgres'),
  ('col', 'sources_import.secret_change_le', 'authenticated=r/postgres'),
  ('col', 'sources_import.secret_change_par', 'authenticated=r/postgres'),
  ('col', 'sources_import.secret_revele_le', 'authenticated=r/postgres'),
  ('col', 'sources_import.secret_revele_par', 'authenticated=r/postgres'),
  ('col', 'sources_import.secret_url_requis', 'authenticated=r/postgres'),
  ('col', 'sources_import.signature_algo', 'authenticated=r/postgres'),
  ('col', 'sources_import.signature_dernier_echec', 'authenticated=r/postgres'),
  ('col', 'sources_import.signature_echecs', 'authenticated=r/postgres'),
  ('col', 'sources_import.signature_encodage', 'authenticated=r/postgres'),
  ('col', 'sources_import.signature_entete', 'authenticated=r/postgres'),
  ('col', 'sources_import.signature_prefixe', 'authenticated=r/postgres'),
  ('col', 'sources_import.spreadsheet_id', 'authenticated=r/postgres'),
  ('col', 'sources_import.tenant_id', 'authenticated=r/postgres'),
  ('col', 'sources_import.token_apercu', 'authenticated=r/postgres'),
  ('col', 'sources_import.token_hash', 'authenticated=r/postgres'),
  ('col', 'sources_import.type', 'authenticated=r/postgres'),
  ('col', 'sources_import.vendeur_id', 'authenticated=r/postgres'),
  ('def', 'postgres|public|S', 'anon=rwU/postgres,authenticated=rwU/postgres,postgres=rwU/postgres,service_role=rwU/postgres'),
  ('def', 'postgres|public|f', 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('def', 'postgres|public|r', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('def', 'supabase_admin|public|S', 'anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,postgres=rwU/supabase_admin,service_role=rwU/supabase_admin'),
  ('def', 'supabase_admin|public|f', 'anon=X/supabase_admin,authenticated=X/supabase_admin,postgres=X/supabase_admin,service_role=X/supabase_admin'),
  ('def', 'supabase_admin|public|r', 'anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,postgres=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin'),
  ('fn', 'a_la_permission(text)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'actualiser_stock_apres_mouvement()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'affecter_agent_lot(uuid,uuid[],uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'affecter_livreur_lot(uuid,uuid[],uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'attribuer_tracking()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'auto_affecter_agent()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'auto_affecter_livreur()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'changer_statut_lot(uuid,uuid[],text,text,timestamp with time zone)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'check_agent_pays()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'check_fiche_tenant()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'check_livraison_coherente()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'check_livreur_pays()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'chemin_image_produit_valide(text)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'choisir_agent(uuid,uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'choisir_livreur(uuid,uuid,text,uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'commande_de_mon_agent(uuid)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'commande_de_mon_seller(uuid)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'commande_expediee(uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'commande_pays_de_l_entreprise()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'commande_produit_id()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'consommer_quota(text,integer,integer,integer,integer)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'corriger_quantite_recue(uuid,integer)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'creer_source_api(uuid,text,text,uuid,text,text,boolean)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'creer_source_import(uuid,text,text,uuid,text,text)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'definir_secret_source(uuid,text)', 'postgres=X/postgres'),
  ('fn', 'delai_prise_en_charge(uuid,timestamp with time zone,timestamp with time zone)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'ecrire_historique_agent()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'ecrire_historique_livreur()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'ecrire_historique_statut()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'ecrire_nom_produit_historique()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'enregistrer_appel(uuid,uuid,uuid,uuid,text,text,text,integer,timestamp with time zone,jsonb)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'entrepot_commande_auto()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'entrepot_du_pays(uuid,uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'est_ma_livraison(uuid)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'est_prise_en_charge(text,uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'est_responsable()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'est_statut_ouvert(uuid,text)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'est_tentative(uuid,text,uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'est_vendeur_du_tenant(uuid,uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'exiger_secret_url(uuid,boolean)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'expedition_modifiable(uuid)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'expedition_pays_destination()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'expedition_quantite_recue()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'expedition_reception_figee()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'expedition_visible(uuid)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'expeditions_garde()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'expeditions_produits_du_vendeur()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'expeditions_reference()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'fn_ajuster_stock_livraison()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'gere_la_config()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'get_mes_permissions()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'get_my_tenant_id()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'historique_affectations_garde()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'historique_statuts_garde()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'historiser_affectation(text,commandes,uuid,uuid,boolean)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'identifiants_source(uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'is_super_admin()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'livreur_pour_commande(uuid,uuid,uuid,text,uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'marquer_reception_sans_mouvement()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'mon_agent_id()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'mon_livreur_id()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'mon_role()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'noter_echec_signature(uuid)', 'postgres=X/postgres'),
  ('fn', 'pays_du_produit(uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'peut_gerer_source(uuid,uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'peut_modifier_image_produit(text)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'produit_de_commande(uuid,text)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'produits_en_stock(uuid,uuid[])', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'produits_proprietaire()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'protege_fiche_agent()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'protege_fiche_livreur()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'rattacher_produit_pays(uuid,uuid[])', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'recalculer_suivi_statuts(uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'receptionner_expedition(uuid,timestamp with time zone,uuid,jsonb)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'regenerer_identifiants_source(uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'regenerer_jeton_source(uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'regenerer_secret_source(uuid)', 'postgres=X/postgres'),
  ('fn', 'reglement_modifiable(uuid)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'reglement_visible(uuid)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'reglements_garde()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'reglements_lignes_garde()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'reglements_reference()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'regler_signature_source(uuid,text)', 'postgres=X/postgres'),
  ('fn', 'remonte_efface_apres_appel()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'remonte_garde()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'remonter_leads(uuid,uuid[])', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'remplir_entrepots_commandes()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'remplir_produits_commandes()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'remplir_suivi_statuts()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'remplir_zones_commandes()', 'postgres=X/postgres'),
  ('fn', 'resoudre_entrepot_commande(uuid,text,uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'resume_delais(numeric[])', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'reveler_derriere_mot_de_passe(uuid,text,text)', 'postgres=X/postgres'),
  ('fn', 'reveler_secret_source(uuid,text)', 'postgres=X/postgres'),
  ('fn', 'reveler_secret_url(uuid,text)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'rls_auto_enable()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'semer_statuts(uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'set_tenant_id_auto()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'source_creer_complete(uuid,text,text,uuid,text,text,boolean)', 'postgres=X/postgres'),
  ('fn', 'source_geree(uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'source_m_appartient(uuid)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'source_regenerer_complete(uuid)', 'postgres=X/postgres'),
  ('fn', 'sources_identifiants()', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'sources_jeton_garde()', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'sources_pays_defaut()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'sources_prefixe_lead()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'sources_signature_garde()', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'sources_signature_tirage()', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'stats_dashboard(uuid,timestamp with time zone,timestamp with time zone)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'statut_cible(text)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'statut_ouvert_sans_livreur()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'statut_pending_commande()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'statut_pending_fige()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'statuts_standard_liste()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'suivi_statuts(uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'suivi_statuts_garde()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'supprimer_pays(uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'sync_nom_vers_user_roles()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'tenants_semer_statuts()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'texte_normalise(text)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'tirer_secret_signature()', '=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'tirer_secret_url()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'unaccent_simple(text)', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'utilisateur_du_tenant(uuid,uuid)', 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'valider_commande_trigger()', '=X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'vider_donnees_operationnelles(uuid)', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'zone_commande_auto()', 'postgres=X/postgres,service_role=X/postgres'),
  ('fn', 'zone_de_commande(uuid,uuid,text)', 'postgres=X/postgres,service_role=X/postgres'),
  ('opt', 'v_pays_livrables', ''),
  ('rel', 'agents', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'api_quota', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'appels', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'commandes', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'commandes_tracking_seq', 'anon=rwU/postgres,authenticated=rwU/postgres,postgres=rwU/postgres,service_role=rwU/postgres'),
  ('rel', 'entrepots', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'expeditions', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'expeditions_numero_seq', 'anon=rwU/postgres,authenticated=rwU/postgres,postgres=rwU/postgres,service_role=rwU/postgres'),
  ('rel', 'expeditions_produits', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'historique_affectations', 'postgres=arwdDxtm/postgres,service_role=r/postgres'),
  ('rel', 'historique_statuts', 'postgres=arwdDxtm/postgres,service_role=r/postgres'),
  ('rel', 'imports_bruts', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'journal_revelations', 'postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'journal_revelations_id_seq', 'anon=rwU/postgres,authenticated=rwU/postgres,postgres=rwU/postgres,service_role=rwU/postgres'),
  ('rel', 'livraisons', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'livreurs', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'motifs_retour', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'mouvements_stock', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'paiements', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'pays', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'permissions', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'produits', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'reglements', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'reglements_commandes', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'reglements_numero_seq', 'anon=rwU/postgres,authenticated=rwU/postgres,postgres=rwU/postgres,service_role=rwU/postgres'),
  ('rel', 'role_permissions', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'roles', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'sources_import', 'anon=awdDxtm/postgres,authenticated=awdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'statuts', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'stocks', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'tenants', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'user_roles', 'authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_caisses_livreur', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_commandes_a_assigner', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_commandes_a_regler', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_commandes_stock_en_attente', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_historique_affectations', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_historique_statuts', 'authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_images_produits_orphelines', 'postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_options_filtres', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'v_pays_livrables', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'),
  ('rel', 'zones', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres');
-- ===== FIN DES LITTÉRAUX =====

-- ---------------------------------------------------------------------------
-- Outils (temporaires : pg_temp, disparaissent avec la session)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.etat_acl()
returns table (quoi text, objet text, acl text)
language sql stable as $f$

  select 'rel'::text as quoi, c.relname::text as objet, coalesce(array_to_string(array(select x::text from unnest(c.relacl) x order by x::text collate "C"), ','), '') as acl
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
  union all
  select 'col', c.relname || '.' || a.attname, coalesce(array_to_string(array(select x::text from unnest(a.attacl) x order by x::text collate "C"), ','), '')
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  union all
  select 'fn', p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')', coalesce(array_to_string(array(select x::text from unnest(p.proacl) x order by x::text collate "C"), ','), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
  union all
  select 'def', pg_get_userbyid(d.defaclrole) || '|'
                || case when d.defaclnamespace = 0 then '(global)' else d.defaclnamespace::regnamespace::text end
                || '|' || d.defaclobjtype::text,
         coalesce(array_to_string(array(select x::text from unnest(d.defaclacl) x order by x::text collate "C"), ','), '')
    from pg_default_acl d
   where d.defaclnamespace in (0, 'public'::regnamespace)
  union all
  select 'opt', c.relname, coalesce(array_to_string(c.reloptions, ','), '')
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname = 'v_pays_livrables'

$f$;

-- Les droits EFFECTIFS de chaque rôle (sauf anon et les rôles pg_*) sur chaque
-- objet de public : table, colonne, séquence, fonction, schéma.
create or replace function pg_temp.droits_effectifs()
returns table (role text, quoi text, objet text, priv text, ok boolean)
language sql stable as $f$
  with roles as (select rolname::text as rolname from pg_roles where rolname !~ '^pg_' and rolname <> 'anon'),
  rel as (select c.oid, c.relname::text as relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')),
  seq as (select c.oid, c.relname::text as relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'),
  tp as (select unnest(case when current_setting('server_version_num')::int >= 170000
                            then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                            else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] end) as p)
  select r.rolname, 'rel', rel.relname, tp.p, has_table_privilege(r.rolname, rel.oid, tp.p) from roles r, rel, tp
  union all
  select r.rolname, 'seq', s.relname, sp.p, has_sequence_privilege(r.rolname, s.oid, sp.p)
    from roles r, seq s, (values ('SELECT'), ('UPDATE'), ('USAGE')) sp(p)
  union all
  select r.rolname, 'col', rel.relname || '.' || a.attname, cp.p, has_column_privilege(r.rolname, rel.oid, a.attnum, cp.p)
    from roles r, rel
    join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped,
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) cp(p)
  union all
  select r.rolname, 'fn', p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')', 'EXECUTE', has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    from roles r, pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select r.rolname, 'schema', 'public', sp.p, has_schema_privilege(r.rolname, 'public', sp.p)
    from roles r, (values ('USAGE'), ('CREATE')) sp(p)
$f$;

-- Ce qu'anon peut encore faire dans public (doit être vide après le fichier).
create or replace function pg_temp.droits_anon()
returns table (quoi text, objet text, priv text)
language sql stable as $f$
  select 'rel', c.relname::text, p
    from pg_class c,
         unnest(case when current_setting('server_version_num')::int >= 170000
                     then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                     else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] end) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and has_table_privilege('anon', c.oid, p)
  union all
  select 'col', c.relname::text, 'une colonne'
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
  union all
  select 'seq', c.relname::text, p
    from pg_class c, unnest(array['SELECT', 'UPDATE', 'USAGE']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and has_sequence_privilege('anon', c.oid, p)
  union all
  select 'fn', p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')', 'EXECUTE'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
$f$;

-- Rend la liste de droits d'un objet égale à la photo : donne ce qui manque,
-- retire ce qui est en trop.
create or replace function pg_temp.converger(p_quoi text, p_objet text, p_acl text)
returns integer
language plpgsql as $f$
declare
  v_oid    oid;
  v_kind   "char";
  v_col    name;
  v_sur    text;
  v_actuel aclitem[];
  v_voulu  aclitem[] := case when p_acl = '' then '{}'::aclitem[] else ('{' || p_acl || '}')::aclitem[] end;
  v_qui    text;
  v_n      integer := 0;
  r        record;
begin
  if p_quoi in ('rel', 'col') then
    select c.oid, c.relkind, c.relacl into v_oid, v_kind, v_actuel
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = split_part(p_objet, '.', 1);
    if v_oid is null then raise exception 'Retour : % % n''existe plus.', p_quoi, p_objet; end if;
    if p_quoi = 'col' then
      v_col := split_part(p_objet, '.', 2);
      select a.attacl into v_actuel from pg_attribute a where a.attrelid = v_oid and a.attname = v_col;
    end if;
    v_sur := case when v_kind = 'S' then 'sequence ' else 'table ' end || v_oid::regclass::text;
  else
    select p.oid, p.proacl into v_oid, v_actuel from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')' = p_objet;
    if v_oid is null then raise exception 'Retour : la fonction % n''existe plus.', p_objet; end if;
    v_sur := 'function ' || v_oid::regprocedure::text;
  end if;
  for r in select x.grantee, x.privilege_type, x.is_grantable from aclexplode(v_voulu) x
           except select y.grantee, y.privilege_type, y.is_grantable from aclexplode(coalesce(v_actuel, '{}'::aclitem[])) y loop
    v_qui := case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end;
    execute format('grant %s%s on %s to %s%s', r.privilege_type,
                   case when v_col is not null then ' (' || quote_ident(v_col) || ')' else '' end,
                   v_sur, v_qui, case when r.is_grantable then ' with grant option' else '' end);
    v_n := v_n + 1;
  end loop;
  for r in select y.grantee, y.privilege_type from aclexplode(coalesce(v_actuel, '{}'::aclitem[])) y
           except select x.grantee, x.privilege_type from aclexplode(v_voulu) x loop
    v_qui := case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end;
    execute format('revoke %s%s on %s from %s', r.privilege_type,
                   case when v_col is not null then ' (' || quote_ident(v_col) || ')' else '' end, v_sur, v_qui);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$f$;

do $$
declare
  v_diff text;
  v_n    integer := 0;
  v_sa   boolean := true;
  r      record;
begin
  -- les droits par défaut d'avant
  execute 'alter default privileges for role postgres in schema public grant all on tables to anon';
  execute 'alter default privileges for role postgres in schema public grant select, update, usage on sequences to anon';
  execute 'alter default privileges for role postgres in schema public grant execute on functions to anon';
  execute 'alter default privileges for role postgres grant execute on functions to public';
  begin
    execute 'alter default privileges for role supabase_admin in schema public grant all on tables to anon';
    execute 'alter default privileges for role supabase_admin in schema public grant select, update, usage on sequences to anon';
    execute 'alter default privileges for role supabase_admin in schema public grant execute on functions to anon';
    execute 'alter default privileges for role supabase_admin grant execute on functions to public';
  exception when insufficient_privilege or undefined_object then
    v_sa := false;
  end;

  -- chaque objet, exactement comme sur la photo
  for r in select * from _acl_lu where quoi in ('rel', 'col', 'fn') order by quoi, objet loop
    v_n := v_n + pg_temp.converger(r.quoi, r.objet, r.acl);
  end loop;

  -- l'option de la vue
  for r in select * from _acl_lu where quoi = 'opt' loop
    if r.acl = '' then
      execute format('alter view public.%I reset (security_barrier)', r.objet);
    else
      execute format('alter view public.%I reset (security_barrier)', r.objet);
      execute format('alter view public.%I set (%s)', r.objet, r.acl);
    end if;
  end loop;

  -- vérification : la base = la photo, objet par objet
  select string_agg(d, ', ') into v_diff from (
    select coalesce(l.quoi, e.quoi) || ' ' || coalesce(l.objet, e.objet) as d
      from _acl_lu l full join pg_temp.etat_acl() e on e.quoi = l.quoi and e.objet = l.objet
     where l.acl is distinct from e.acl
     order by 1 limit 40) x;
  if v_diff is not null then
    raise exception 'RETOUR INCOMPLET — différent de la photo : %. Le retour est annulé en entier (la base reste comme avant ce retour).', v_diff;
  end if;
  raise notice 'Retour fait : % droit(s) remis ou retiré(s) ; chaque relation, colonne, fonction, droit par défaut = la photo (vérifié)%.',
    v_n, case when v_sa then '' else ' (droits par défaut de supabase_admin non touchés : pas le droit)' end;
end $$;

drop table if exists pg_temp._acl_lu;
