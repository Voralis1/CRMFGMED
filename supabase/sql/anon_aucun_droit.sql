-- =============================================================================
-- ANON NE TIENT PLUS RIEN DANS public — 02/11/2026
-- =============================================================================
--
-- NE CHANGE AUCUNE DONNÉE. Change des DROITS — le fichier le plus dangereux du
-- projet : un droit perdu par authenticated ou service_role sur une seule
-- fonction et plus aucune politique ne se résout (l'application s'arrête).
-- D'où : une photo, une vérification TOTALE, une répétition des vrais chemins.
-- Tout est dans UN bloc : une seule erreur et RIEN n'est fait.
--
-- POURQUOI. anon (la clé publique, un compte que personne n'utilise pour se
-- connecter) tenait (lu le 02/11) : tous les droits sur 29 tables — TRUNCATE
-- compris, que la RLS ne couvre pas —, sur 6 vues, select/update sur 4
-- séquences (setval de commandes_tracking_seq = des n° de suivi réémis), et
-- l'exécution de 48 fonctions. Rien de tout ça n'était utilisable AUJOURD'HUI,
-- mais seulement grâce à autre chose (la RLS, le WHERE d'une vue, l'API REST
-- qui n'expose ni TRUNCATE ni setval) : de la chance, pas une défense. Et la
-- SOURCE : les droits PAR DÉFAUT de postgres (et supabase_admin) dans public
-- donnaient tout à anon sur chaque NOUVEL objet — chaque fichier SQL du projet
-- lui en a redonné. Personne n'a besoin d'anon (lu le 02/11 : la page de
-- connexion n'interroge pas la base, chaque Edge Function utilise la clé
-- service ; les connexions passent par Supabase Auth, hors public).
--
-- CE QUE FAIT LE FICHIER (dans cet ordre, un seul bloc) :
--   §0 la base doit être EXACTEMENT la photo ci-dessous (droits de chaque
--      relation, colonne, fonction, droits par défaut, option de la vue) —
--      sinon le retour arrière ne la remettrait pas : refus, rien fait.
--      Déjà passé (anon ne tient plus rien) → « déjà en place », rien fait.
--   §1 photo des droits EFFECTIFS de chaque rôle sauf anon (authenticated,
--      service_role, authenticator, supabase_auth_admin…) sur chaque objet.
--   §2 LES DROITS PAR DÉFAUT d'abord : postgres ne donne plus rien à anon sur
--      les nouvelles tables, séquences, fonctions de public, et une nouvelle
--      fonction n'est plus exécutable par PUBLIC (défaut global de postgres :
--      authenticated et service_role la reçoivent toujours par le défaut de
--      public). Même chose pour supabase_admin SI postgres en a le droit —
--      sinon un avis le dit (ses objets dans public : aucun, lu le 02/11).
--   §3 anon perd tout sur chaque table, vue, séquence de public.
--   §4 fonctions : PUBLIC et anon perdent l'exécution ; chaque rôle qui
--      l'avait PAR PUBLIC la reçoit explicitement (sinon l'application tombe).
--   §5 v_pays_livrables : security_barrier.
--   §6 VÉRIFICATION TOTALE : les droits effectifs de chaque rôle sauf anon,
--      objet par objet, colonne par colonne = la photo du §1 ; anon ne tient
--      plus rien ; les droits par défaut ne donnent plus rien à anon/PUBLIC.
--      Une seule différence → rien n'est fait.
--   §7 RÉPÉTITION des vrais chemins (annulée) : un vendeur lit ses commandes
--      et en crée une ; un agent lit ses leads, son appel est enregistré
--      (confirmer-appel, clé service) ; un livreur lit ses livraisons, la
--      sienne est marquée livrée avec son paiement (confirmer-livraison, clé
--      service) ; un manager passe un lot (changer_statut_lot) et lit
--      l'historique ; l'API (import-commande, clé service) crée une commande ;
--      anon est refusé partout (lecture, fonction, setval, TRUNCATE). Un seul
--      chemin qui n'aboutit pas → rien n'est fait.
--
-- On GARDE l'accès d'anon au schéma (USAGE) : il n'y trouve plus rien.
--
-- RETOUR ARRIÈRE : anon_aucun_droit_retour.sql (copie sur le Bureau) — remet
-- chaque objet EXACTEMENT comme dans la photo et le vérifie. Une collée.
--
-- À LANCER à un moment calme, personne au travail. Généré par
-- supabase/sql/tests/generer_anon_aucun_droit.py — ne pas éditer les littéraux
-- à la main : régénérer depuis la base.
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

do $$
declare
  v_diff   text;
  v_sa     boolean := false;
  v_n      integer;
  n_rel    integer := 0;
  n_fn     integer := 0;
  n_redon  integer := 0;
  r        record;
  -- répétition
  v_t uuid; v_vend uuid; v_agent_user uuid; v_agent uuid; v_liv_user uuid; v_liv uuid; v_livraison uuid;
  v_liv_cmd uuid; v_resp uuid; v_lead1 uuid; v_lead2 uuid; v_pays uuid; v_txt text; v_attendu integer;
  v_msg text; v_refus boolean; v_etape text := 'préparation';
begin
  -- §0 ------------------------------------------------------------------------
  select string_agg(d, ', ') into v_diff from (
    select coalesce(l.quoi, e.quoi) || ' ' || coalesce(l.objet, e.objet) as d
      from _acl_lu l full join pg_temp.etat_acl() e on e.quoi = l.quoi and e.objet = l.objet
     where l.acl is distinct from e.acl
     order by 1) x;
  if v_diff is not null then
    if not exists (select 1 from pg_temp.droits_anon())
       and not exists (select 1 from pg_default_acl d
                        where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
                          and d.defaclacl::text like '%anon=%') then
      raise notice 'anon_aucun_droit.sql : déjà en place (anon ne tient rien dans public). Rien n''a été fait.';
      return;
    end if;
    raise exception 'anon_aucun_droit.sql : la base n''est plus celle de la photo (%). Le retour arrière ne la remettrait pas exactement : RIEN n''a été fait. Régénérez les deux fichiers depuis la base.', left(v_diff, 2000);
  end if;

  -- §1 ------------------------------------------------------------------------
  drop table if exists pg_temp._droits_avant;
  create temp table _droits_avant as select * from pg_temp.droits_effectifs();

  -- §2 Les droits par défaut, d'abord -----------------------------------------
  execute 'alter default privileges for role postgres in schema public revoke all on tables from anon';
  execute 'alter default privileges for role postgres in schema public revoke all on sequences from anon';
  execute 'alter default privileges for role postgres in schema public revoke all on functions from anon';
  execute 'alter default privileges for role postgres revoke execute on functions from public';
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
    execute 'alter default privileges for role supabase_admin revoke execute on functions from public';
    v_sa := true;
  exception when insufficient_privilege or undefined_object then
    v_sa := false;
  end;

  -- §3 Tables, vues, séquences ------------------------------------------------
  for r in select c.oid, c.relkind from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f') loop
    execute format('revoke all on %s %s from anon',
                   case when r.relkind = 'S' then 'sequence' else 'table' end, r.oid::regclass);
    n_rel := n_rel + 1;
  end loop;
  for r in select c.oid, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
            where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
              and exists (select 1 from aclexplode(a.attacl) x where x.grantee = 'anon'::regrole) loop
    execute format('revoke all (%I) on table %s from anon', r.attname, r.oid::regclass);
  end loop;

  -- §4 Fonctions --------------------------------------------------------------
  for r in select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (has_function_privilege('anon', p.oid, 'EXECUTE')
                   or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)) loop
    execute format('revoke all on function %s from public, anon', r.oid::regprocedure);
    n_fn := n_fn + 1;
  end loop;
  -- chaque rôle qui l'exécutait (par PUBLIC) la reçoit explicitement
  for r in select a.role, p.oid
             from _droits_avant a
             join pg_proc p on p.pronamespace = 'public'::regnamespace
                           and p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')' = a.objet
            where a.quoi = 'fn' and a.ok
              and not has_function_privilege(a.role, p.oid, 'EXECUTE') loop
    execute format('grant execute on function %s to %I', r.oid::regprocedure, r.role);
    n_redon := n_redon + 1;
  end loop;

  -- §5 ------------------------------------------------------------------------
  execute 'alter view public.v_pays_livrables set (security_barrier = true)';

  -- §6 VÉRIFICATION TOTALE ------------------------------------------------------
  select string_agg(d, ' ; ') into v_diff from (
    select coalesce(a.role, b.role) || ' ' || coalesce(a.quoi, b.quoi) || ' ' || coalesce(a.objet, b.objet) || ' '
           || coalesce(a.priv, b.priv) || ' : avant ' || coalesce(a.ok::text, '—') || ', après ' || coalesce(b.ok::text, '—') as d
      from _droits_avant a full join pg_temp.droits_effectifs() b
        on b.role = a.role and b.quoi = a.quoi and b.objet = a.objet and b.priv = a.priv
     where a.ok is distinct from b.ok
     order by 1 limit 30) x;
  if v_diff is not null then
    raise exception 'anon_aucun_droit.sql — VÉRIFICATION ÉCHOUÉE, un autre rôle qu''anon a changé de droits : %. RIEN n''a été fait.', v_diff;
  end if;
  select string_agg(quoi || ' ' || objet || ' ' || priv, ', ') into v_diff from (select * from pg_temp.droits_anon() limit 30) x;
  if v_diff is not null then
    raise exception 'anon_aucun_droit.sql — VÉRIFICATION ÉCHOUÉE, anon tient encore : %. RIEN n''a été fait.', v_diff;
  end if;
  if exists (select 1 from pg_default_acl d
              where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
                and exists (select 1 from aclexplode(d.defaclacl) x where x.grantee = 'anon'::regrole))
     or not exists (select 1 from pg_default_acl d
                     where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
                       and not exists (select 1 from aclexplode(d.defaclacl) x where x.grantee = 0)) then
    raise exception 'anon_aucun_droit.sql — VÉRIFICATION ÉCHOUÉE : les droits par défaut donnent encore à anon ou à PUBLIC. RIEN n''a été fait.';
  end if;

  -- §7 RÉPÉTITION DES VRAIS CHEMINS (annulée) ------------------------------------
  select ur.tenant_id into v_t
    from public.user_roles ur
   where ur.role = 'seller'
     and exists (select 1 from public.commandes c where c.vendeur_id = ur.user_id and c.tenant_id = ur.tenant_id)
     and exists (select 1 from public.agents a join public.user_roles x on x.user_id = a.user_id and x.role = 'agent'
                  where a.tenant_id = ur.tenant_id and a.actif)
     and exists (select 1 from public.livreurs l join public.livraisons v on v.livreur_id = l.id
                  where l.tenant_id = ur.tenant_id and l.user_id is not null and v.statut in ('a_preparer', 'expedie'))
     and exists (select 1 from public.user_roles m where m.tenant_id = ur.tenant_id and m.role in ('manager', 'admin'))
     and (select count(*) from public.commandes c
           where c.tenant_id = ur.tenant_id and c.statut_confirmation = 'Pending'
             and not exists (select 1 from public.livraisons v where v.commande_id = c.id)) >= 2
   order by (ur.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, ur.tenant_id
   limit 1;
  if v_t is null then
    raise exception 'anon_aucun_droit.sql — RÉPÉTITION IMPOSSIBLE : aucune entreprise avec un vendeur qui a des commandes, un agent actif, un livreur avec une livraison à préparer, un manager et deux leads « Pending » sans livraison. RIEN n''a été fait.';
  end if;
  select ur.user_id into v_vend from public.user_roles ur
   where ur.tenant_id = v_t and ur.role = 'seller'
     and exists (select 1 from public.commandes c where c.vendeur_id = ur.user_id and c.tenant_id = v_t)
   order by ur.user_id limit 1;
  select a.user_id, a.id into v_agent_user, v_agent from public.agents a
    join public.user_roles x on x.user_id = a.user_id and x.role = 'agent'
   where a.tenant_id = v_t and a.actif order by a.id limit 1;
  select l.user_id, l.id, v.id, v.commande_id into v_liv_user, v_liv, v_livraison, v_liv_cmd
    from public.livreurs l join public.livraisons v on v.livreur_id = l.id
   where l.tenant_id = v_t and l.user_id is not null and v.statut in ('a_preparer', 'expedie')
   order by v.created_at desc limit 1;
  select user_id into v_resp from public.user_roles
   where tenant_id = v_t and role in ('manager', 'admin') order by role desc, user_id limit 1;
  select c.id into v_lead1 from public.commandes c
   where c.tenant_id = v_t and c.statut_confirmation = 'Pending'
     and not exists (select 1 from public.livraisons v where v.commande_id = c.id)
   order by c.created_at desc limit 1;
  select c.id into v_lead2 from public.commandes c
   where c.tenant_id = v_t and c.statut_confirmation = 'Pending' and c.id <> v_lead1
     and not exists (select 1 from public.livraisons v where v.commande_id = c.id)
   order by c.created_at desc limit 1;
  select p.id into v_pays from public.pays p where p.tenant_id = v_t order by p.nom limit 1;

  begin
    v_etape := 'vendeur';
    -- le vendeur : ses commandes, l'historique, ses pays, le tableau de bord ; il crée une commande
    select count(*) into v_attendu from public.commandes where tenant_id = v_t and vendeur_id = v_vend;
    perform set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.commandes;
    if v_n <> v_attendu then raise exception 'vendeur : % commande(s) lue(s) au lieu de %', v_n, v_attendu; end if;
    perform count(*) from public.v_historique_statuts;
    perform count(*) from public.v_pays_livrables;
    perform public.stats_dashboard(v_t, '-infinity', 'infinity');
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, vendeur_id)
    values (v_t, 'REPETITION-ANON-V-' || gen_random_uuid(), 'Répétition', '+000', 'Répétition', 1, 0, v_pays, 'Répétition', v_vend)
    returning tracking_number into v_txt;
    execute 'reset role';
    if v_txt is null then raise exception 'vendeur : sa commande n''a pas reçu de n° de suivi'; end if;

    v_etape := 'agent (confirmer-appel)';
    -- l'agent : ses leads ; confirmer-appel (clé service) enregistre son appel
    select count(*) into v_attendu from public.commandes
     where tenant_id = v_t and (agent_id = v_agent or agent_id is null);
    perform set_config('request.jwt.claims', json_build_object('sub', v_agent_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.commandes;
    execute 'reset role';
    if v_n <> v_attendu then raise exception 'agent : % lead(s) lu(s) au lieu de %', v_n, v_attendu; end if;
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    execute 'set local role service_role';
    perform public.enregistrer_appel(v_lead1, v_t, v_agent_user, v_agent, 'Unreached', 'Pending',
                                     'Répétition anon_aucun_droit', 30, null, '{}'::jsonb);
    execute 'reset role';
    if (select statut_confirmation from public.commandes where id = v_lead1) <> 'Unreached'
       or not exists (select 1 from public.historique_statuts where commande_id = v_lead1 and via = 'confirmer-appel'
                        and note = 'Répétition anon_aucun_droit') then
      raise exception 'agent : l''appel n''a pas été enregistré (statut ou historique)';
    end if;

    v_etape := 'livreur (confirmer-livraison)';
    -- le livreur : ses livraisons ; confirmer-livraison (clé service) : livrée + paiement
    select count(*) into v_attendu from public.livraisons where tenant_id = v_t and livreur_id = v_liv;
    perform set_config('request.jwt.claims', json_build_object('sub', v_liv_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.livraisons;
    execute 'reset role';
    if v_n <> v_attendu then raise exception 'livreur : % livraison(s) lue(s) au lieu de %', v_n, v_attendu; end if;
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    execute 'set local role service_role';
    update public.livraisons set statut = 'livre', date_livraison = now() where id = v_livraison;
    update public.commandes set statut_livraison = 'livre', updated_at = now() where id = v_liv_cmd;
    insert into public.paiements (commande_id, livreur_id, tenant_id, montant, methode, statut)
    values (v_liv_cmd, v_liv, v_t, 0, 'cod', 'en_attente');
    execute 'reset role';
    if (select statut from public.livraisons where id = v_livraison) <> 'livre' then
      raise exception 'livreur : la livraison n''est pas passée à « livré »';
    end if;

    v_etape := 'manager (lot)';
    -- le manager : un lot, l'historique, la mesure du délai
    perform set_config('request.jwt.claims', json_build_object('sub', v_resp, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select l.resultat into v_txt from public.changer_statut_lot(v_t, array[v_lead2], 'Unreached', null, null) l;
    select count(*) into v_n from public.v_historique_statuts;
    if to_regprocedure('public.delai_prise_en_charge(uuid, timestamptz, timestamptz)') is not null then
      perform public.delai_prise_en_charge(v_t, '-infinity', 'infinity');
    end if;
    execute 'reset role';
    if v_txt is distinct from 'applique' then raise exception 'manager : le lot a répondu « % »', v_txt; end if;
    if v_n = 0 then raise exception 'manager : historique vide'; end if;

    v_etape := 'API (import-commande)';
    -- l'API (import-commande, clé service) crée une commande
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    execute 'set local role service_role';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, source)
    values (v_t, 'REPETITION-ANON-A-' || gen_random_uuid(), 'Répétition', '+000', 'Répétition', 1, 0, v_pays, 'Répétition', 'api')
    returning tracking_number into v_txt;
    execute 'reset role';
    if v_txt is null then raise exception 'API : la commande n''a pas reçu de n° de suivi'; end if;

    v_etape := 'anon refusé';
    -- anon : refusé partout
    perform set_config('request.jwt.claims', '{}', true);
    execute 'set local role anon';
    v_refus := false; begin perform 1 from public.commandes limit 1; exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon lit encore commandes'; end if;
    v_refus := false; begin perform public.is_super_admin(); exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon exécute encore is_super_admin'; end if;
    v_refus := false; begin perform 1 from public.v_pays_livrables limit 1; exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon lit encore v_pays_livrables'; end if;
    v_refus := false; begin perform setval('public.commandes_tracking_seq', 1); exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon peut encore remettre la séquence des n° de suivi (setval)'; end if;
    v_refus := false; begin execute 'truncate public.motifs_retour'; exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon peut encore vider une table (TRUNCATE)'; end if;
    execute 'reset role';

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'anon_aucun_droit.sql — RÉPÉTITION ÉCHOUÉE (étape : %) : %. RIEN n''a été fait.', v_etape, v_msg;
    end if;
  end;

  raise notice 'anon_aucun_droit.sql : fait. anon ne tient plus rien (% relations, % fonctions retirées à PUBLIC/anon, % droits redonnés explicitement). Droits par défaut de postgres corrigés%. Tous les autres rôles : droits identiques, vérifiés objet par objet. Répétition (vendeur, agent, livreur, manager, API, anon refusé) réussie et annulée.',
    n_rel, n_fn, n_redon,
    case when v_sa then ', et ceux de supabase_admin' else ' (PAS ceux de supabase_admin : postgres n''en a pas le droit — ses nouveaux objets dans public donneraient encore à anon ; aucun le 02/11)' end;
end $$;

drop table if exists pg_temp._acl_lu;
drop table if exists pg_temp._droits_avant;
