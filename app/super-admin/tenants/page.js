'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useMessages } from '../../components/Messages';
import { messageErreur } from '../../../lib/messageErreur.mjs';
import { useLangue } from '../../context/LangueContext';

export default function TenantsPage() {
  const { user, loading: authLoading } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  // Messages du CRM (24/11) au lieu des fenêtres du navigateur.
  const { annoncer, confirmer } = useMessages();
  // Les textes suivent la langue choisie (25/11).
  const { t } = useLangue();
  const router = useRouter();

  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // Création
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTenantNom, setNewTenantNom] = useState('');
  const [newTenantPays, setNewTenantPays] = useState('');

  // Édition
  const [editTenant, setEditTenant] = useState(null);
  const [editNom, setEditNom] = useState('');
  const [editStatut, setEditStatut] = useState('actif');
  // T21 (13/11, reaffectation_delai.sql) : minutes de travail avant qu'un lead non ouvert change d'agent.
  const [editDelai, setEditDelai] = useState('60');

  // Suppression / action en cours
  const [actionEnCours, setActionEnCours] = useState(null);

  // REDIRECTION SÉCURISÉE VIA LA MATRICE DE PERMISSIONS
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/');
      } else if (!hasPermission('menu_tenants')) {
        router.replace('/dashboard');
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router]);

  async function fetchTenants() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTenants(data || []);
    } catch (err) {
      console.error("Erreur lors du chargement des entreprises :", err.message || err);
      setErrorMsg(t('ent.erreurListe'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && hasPermission('menu_tenants')) {
      fetchTenants();
    }
  }, [user, hasPermission]);

  // ------------------------------------------------------------
  // Création
  // ------------------------------------------------------------
  async function handleCreateTenant(e) {
    e.preventDefault();
    if (!newTenantNom.trim()) return;

    try {
      // On s'assure d'envoyer uniquement les champs valides de la table tenants
      const payload = { nom_entreprise: newTenantNom.trim() };

      const { data, error } = await supabase
        .from('tenants')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;

      setTenants([data, ...tenants]);
      setIsModalOpen(false);
      setNewTenantNom('');
      setNewTenantPays('');
    } catch (err) {
      console.error("Erreur de création détaillée :", err.message || JSON.stringify(err));
      annoncer(t('ent.creationImpossible', { erreur: messageErreur(err) }), 'erreur');
    }
  }

  // ------------------------------------------------------------
  // Édition (nom + statut)
  // ------------------------------------------------------------
  function ouvrirEdition(tenant) {
    setEditTenant(tenant);
    setEditNom(tenant.nom_entreprise || '');
    setEditStatut(tenant.statut || 'actif');
    setEditDelai(String(tenant.delai_reaffectation_minutes ?? 60));
  }

  async function handleUpdateTenant(e) {
    e.preventDefault();
    if (!editTenant || !editNom.trim()) return;
    const delai = Number(editDelai);
    if (!Number.isInteger(delai) || delai < 5 || delai > 480) {
      annoncer(t('ent.delaiInvalide'), 'erreur');
      return;
    }

    setActionEnCours(editTenant.id);
    try {
      const { data, error } = await supabase
        .from('tenants')
        .update({ nom_entreprise: editNom.trim(), statut: editStatut, delai_reaffectation_minutes: delai })
        .eq('id', editTenant.id)
        .select()
        .single();

      if (error) throw error;

      setTenants(tenants.map((t) => (t.id === data.id ? data : t)));
      setEditTenant(null);
    } catch (err) {
      console.error("Erreur de modification détaillée :", err.message || JSON.stringify(err));
      annoncer(t('ent.modificationImpossible', { erreur: messageErreur(err) }), 'erreur');
    } finally {
      setActionEnCours(null);
    }
  }

  // ------------------------------------------------------------
  // Suspendre / Réactiver
  // ------------------------------------------------------------
  async function toggleSuspension(tenant) {
    const nouveauStatut = tenant.statut === 'suspendu' ? 'actif' : 'suspendu';
    const confirmation = await confirmer(
      nouveauStatut === 'suspendu'
        ? { titre: t('ent.suspendreTitre'), message: t('ent.suspendreMsg', { nom: tenant.nom_entreprise }), bouton: t('ent.suspendre'), danger: true }
        : { titre: t('ent.reactiverTitre'), message: t('ent.reactiverMsg', { nom: tenant.nom_entreprise }), bouton: t('ent.reactiver') }
    );
    if (!confirmation) return;

    setActionEnCours(tenant.id);
    try {
      const { data, error } = await supabase
        .from('tenants')
        .update({ statut: nouveauStatut })
        .eq('id', tenant.id)
        .select()
        .single();

      if (error) throw error;
      setTenants(tenants.map((t) => (t.id === data.id ? data : t)));
    } catch (err) {
      console.error("Erreur de suspension :", err.message || err);
      annoncer(t('ent.statutImpossible', { erreur: messageErreur(err) }), 'erreur');
    } finally {
      setActionEnCours(null);
    }
  }

  // ------------------------------------------------------------
  // Suppression définitive
  // ------------------------------------------------------------
  async function handleDeleteTenant(tenant) {
    const confirmation = await confirmer({
      titre: t('ent.supprimerTitre'),
      message: t('ent.supprimerMsg', { nom: tenant.nom_entreprise }),
      bouton: t('ent.supprimer'), danger: true,
    });
    if (!confirmation) return;

    setActionEnCours(tenant.id);
    try {
      const { error } = await supabase
        .from('tenants')
        .delete()
        .eq('id', tenant.id);

      if (error) {
        // 23503 (NO ACTION : commandes, agents, comptes) et 23001 (RESTRICT :
        // travail, argent, historique — fk_entreprises.sql, 12/11) : elle a travaillé.
        if (error.code === '23503' || error.code === '23001') {
          annoncer(t('ent.nePeutSupprimer', { nom: tenant.nom_entreprise }), 'erreur');
        } else {
          throw error;
        }
        return;
      }

      setTenants(tenants.filter((t) => t.id !== tenant.id));
    } catch (err) {
      console.error("Erreur de suppression :", err.message || err);
      annoncer(t('ent.suppressionImpossible', { erreur: messageErreur(err) }), 'erreur');
    } finally {
      setActionEnCours(null);
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  };

  // Badge lisible (23/11) : un point de couleur, le texte foncé.
  const badgeStatut = (statut) => {
    const points = { actif: '#2E7D53', suspendu: '#FFB162', archive: '#C9C1B1' };
    const labels = { actif: t('ent.st.actif'), suspendu: t('ent.st.suspendu'), archive: t('ent.st.archive') };
    const couleur = points[statut] || points.actif;
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-[#1B2632] border whitespace-nowrap"
        style={{ backgroundColor: `${couleur}22`, borderColor: `${couleur}66` }}>
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: couleur }} />
        {labels[statut] || statut || t('ent.st.actif')}
      </span>
    );
  };

  if (authLoading || permsLoading || !hasPermission('menu_tenants')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">{t('ent.verif')}</div>;
  }

  if (loading) {
    return <div className="p-8 text-center text-[#7a7365]">{t('ent.chargement')}</div>;
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-6 relative pt-4 sm:pt-2 px-4 sm:px-6 pb-10">

      {errorMsg && (
        <div className="bg-[#A35139]/10 border border-[#A35139]/30 text-[#A35139] px-4 py-3 rounded-xl">
          {errorMsg}
        </div>
      )}

      {/* En-tête */}
      {/* En-tête compact (23/11), comme les autres pages. */}
      <div className="flex flex-wrap gap-3 justify-between items-center border-b border-[#C9C1B1]/50 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-[#1B2632]">{t('ent.titre')}</h1>
          <span className="text-sm font-semibold text-[#1B2632]/50">{tenants.length}</span>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-[#1B2632] hover:bg-[#2C3B4D] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
        >
          <span className="text-lg leading-none">+</span> {t('ent.nouvelle')}
        </button>
      </div>

      {/* Tableau des Tenants */}
      <div className="bg-white shadow-sm rounded-xl border border-[#C9C1B1]/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm text-[#3a3529]">
            <thead className="bg-[#EEE9DF]/60 text-[#7a7365] text-xs uppercase font-semibold border-b border-[#C9C1B1]/50">
              <tr>
                <th className="px-6 py-4">{t('ent.nom')}</th>
                <th className="px-6 py-4">{t('ent.dateCreation')}</th>
                <th className="px-6 py-4">{t('ent.statut')}</th>
                <th className="px-6 py-4 text-right">{t('ent.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEE9DF]">
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-6 py-8 text-center text-[#9a9384] italic">
                    {t('ent.aucune')}
                  </td>
                </tr>
              ) : (
                tenants.map((tenant) => {
                  const enCours = actionEnCours === tenant.id;
                  return (
                    <tr key={tenant.id} className="hover:bg-[#EEE9DF]/30 transition-colors">
                      <td className="px-6 py-4 font-bold text-[#1B2632]">
                        {tenant.nom_entreprise || t('ent.nomManquant')}
                      </td>
                      <td className="px-6 py-4">{formatDate(tenant.created_at)}</td>
                      <td className="px-6 py-4">{badgeStatut(tenant.statut)}</td>
                      <td className="px-6 py-4">
                        {/* Trois boutons de même taille (23/11) : Modifier plein, Suspendre
                            contour orange, Supprimer contour rouge avec sa corbeille. */}
                        <div className="flex justify-end items-center gap-2">
                          <button
                            onClick={() => ouvrirEdition(tenant)}
                            disabled={enCours}
                            className="text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-40 cursor-pointer"
                          >
                            {t('ent.modifier')}
                          </button>
                          <button
                            onClick={() => toggleSuspension(tenant)}
                            disabled={enCours}
                            className={`text-xs font-bold px-3.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 cursor-pointer ${
                              tenant.statut === 'suspendu'
                                ? 'border-[#2E7D53]/50 text-[#2E7D53] hover:bg-[#2E7D53]/10'
                                : 'border-[#FFB162] text-[#8a5a1f] hover:bg-[#FFB162]/15'}`}
                          >
                            {tenant.statut === 'suspendu' ? t('ent.reactiver') : t('ent.suspendre')}
                          </button>
                          <button
                            onClick={() => handleDeleteTenant(tenant)}
                            disabled={enCours}
                            title={t('ent.supprimerBtnTitre')}
                            className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg border border-[#A35139]/40 text-[#A35139] hover:bg-[#A35139]/10 transition-colors disabled:opacity-40 cursor-pointer"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                            {t('ent.supprimer')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL : Nouvelle Entreprise */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1B2632]/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-[#C9C1B1]/50 flex justify-between items-center bg-[#EEE9DF]/40">
              <h3 className="font-bold text-[#1B2632] text-lg">{t('ent.creerTitre')}</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#9a9384] hover:text-[#1B2632] transition-colors cursor-pointer text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#1B2632] mb-1">
                  {t('ent.nomPartenaire')}
                </label>
                <input
                  type="text"
                  placeholder={t('ent.exNom')}
                  value={newTenantNom}
                  onChange={(e) => setNewTenantNom(e.target.value)}
                  className="w-full border border-[#C9C1B1] px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]/20 focus:border-[#1B2632]"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1B2632] mb-1">
                  {t('ent.paysOperation')}
                </label>
                <input
                  type="text"
                  placeholder={t('ent.exPays')}
                  value={newTenantPays}
                  onChange={(e) => setNewTenantPays(e.target.value)}
                  className="w-full border border-[#C9C1B1] px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]/20 focus:border-[#1B2632]"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-[#C9C1B1] text-[#1B2632] rounded-lg text-sm font-medium hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer"
                >
                  {t('ent.annuler')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {t('ent.creer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL : Modifier l'entreprise */}
      {editTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1B2632]/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-[#C9C1B1]/50 flex justify-between items-center bg-[#EEE9DF]/40">
              <h3 className="font-bold text-[#1B2632] text-lg">{t('ent.modifierTitre')}</h3>
              <button
                onClick={() => setEditTenant(null)}
                className="text-[#9a9384] hover:text-[#1B2632] transition-colors cursor-pointer text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleUpdateTenant} className="p-6 space-y-4">
              {/* L'identifiant (23/11) : retiré du tableau, gardé ici avec « Copier ». */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#7a7365] shrink-0">ID</span>
                <code className="font-mono text-[#1B2632]/70 truncate">{editTenant.id}</code>
                <button type="button"
                  onClick={() => { navigator.clipboard?.writeText(editTenant.id).catch(() => {}) }}
                  className="ml-auto shrink-0 px-2 py-1 rounded-md border border-[#C9C1B1] text-[#1B2632] hover:bg-[#EEE9DF] cursor-pointer">
                  {t('ent.copier')}
                </button>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#1B2632] mb-1">
                  {t('ent.nomObl')}
                </label>
                <input
                  type="text"
                  value={editNom}
                  onChange={(e) => setEditNom(e.target.value)}
                  className="w-full border border-[#C9C1B1] px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]/20 focus:border-[#1B2632]"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1B2632] mb-1">{t('ent.statut')}</label>
                <select
                  value={editStatut}
                  onChange={(e) => setEditStatut(e.target.value)}
                  className="w-full border border-[#C9C1B1] px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]/20 focus:border-[#1B2632]"
                >
                  <option value="actif">{t('ent.optActif')}</option>
                  <option value="suspendu">{t('ent.optSuspendu')}</option>
                  <option value="archive">{t('ent.optArchive')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1B2632] mb-1">{t('ent.delai')}</label>
                <input
                  type="number" min="5" max="480" step="1"
                  value={editDelai}
                  onChange={(e) => setEditDelai(e.target.value)}
                  className="w-full border border-[#C9C1B1] px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]/20 focus:border-[#1B2632]"
                />
                <p className="text-xs text-[#1B2632]/55 mt-1">
                  {t('ent.delaiAide')}
                </p>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditTenant(null)}
                  className="flex-1 px-4 py-2.5 border border-[#C9C1B1] text-[#1B2632] rounded-lg text-sm font-medium hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer"
                >
                  {t('ent.annuler')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {t('ent.enregistrer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}