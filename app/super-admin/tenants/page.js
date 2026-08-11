'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';

export default function TenantsPage() {
  const { user, loading: authLoading } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
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
      setErrorMsg("Impossible de charger la liste des entreprises.");
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
      alert("Erreur lors de la création de l'entreprise : " + (err.message || "Vérifiez vos colonnes en base de données."));
    }
  }

  // ------------------------------------------------------------
  // Édition (nom + statut)
  // ------------------------------------------------------------
  function ouvrirEdition(tenant) {
    setEditTenant(tenant);
    setEditNom(tenant.nom_entreprise || '');
    setEditStatut(tenant.statut || 'actif');
  }

  async function handleUpdateTenant(e) {
    e.preventDefault();
    if (!editTenant || !editNom.trim()) return;

    setActionEnCours(editTenant.id);
    try {
      const { data, error } = await supabase
        .from('tenants')
        .update({ nom_entreprise: editNom.trim(), statut: editStatut })
        .eq('id', editTenant.id)
        .select()
        .single();

      if (error) throw error;

      setTenants(tenants.map((t) => (t.id === data.id ? data : t)));
      setEditTenant(null);
    } catch (err) {
      console.error("Erreur de modification détaillée :", err.message || JSON.stringify(err));
      alert("Erreur lors de la modification de l'entreprise : " + (err.message || "Erreur inconnue"));
    } finally {
      setActionEnCours(null);
    }
  }

  // ------------------------------------------------------------
  // Suspendre / Réactiver
  // ------------------------------------------------------------
  async function toggleSuspension(tenant) {
    const nouveauStatut = tenant.statut === 'suspendu' ? 'actif' : 'suspendu';
    const confirmation = window.confirm(
      nouveauStatut === 'suspendu'
        ? `Suspendre "${tenant.nom_entreprise}" ? Ses utilisateurs ne pourront plus se connecter tant qu'elle est suspendue.`
        : `Réactiver "${tenant.nom_entreprise}" ?`
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
      alert("Impossible de changer le statut : " + (err.message || "Erreur"));
    } finally {
      setActionEnCours(null);
    }
  }

  // ------------------------------------------------------------
  // Suppression définitive
  // ------------------------------------------------------------
  async function handleDeleteTenant(tenant) {
    const confirmation = window.confirm(
      `Supprimer définitivement "${tenant.nom_entreprise}" ?\n\nCette action est IRRÉVERSIBLE.`
    );
    if (!confirmation) return;

    setActionEnCours(tenant.id);
    try {
      const { error } = await supabase
        .from('tenants')
        .delete()
        .eq('id', tenant.id);

      if (error) {
        if (error.code === '23503') {
          alert(`Impossible de supprimer "${tenant.nom_entreprise}" : des données y sont rattachées.`);
        } else {
          throw error;
        }
        return;
      }

      setTenants(tenants.filter((t) => t.id !== tenant.id));
    } catch (err) {
      console.error("Erreur de suppression :", err.message || err);
      alert("Erreur lors de la suppression de l'entreprise : " + (err.message || "Erreur"));
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

  const badgeStatut = (statut) => {
    const styles = {
      actif: 'bg-[#2C3B4D]/10 text-[#2C3B4D] border-[#2C3B4D]/30',
      suspendu: 'bg-[#A35139]/10 text-[#A35139] border-[#A35139]/30',
      archive: 'bg-[#C9C1B1]/30 text-[#7a7365] border-[#C9C1B1]',
    };
    const labels = { actif: 'Actif', suspendu: 'Suspendu', archive: 'Archivé' };
    const style = styles[statut] || styles.actif;
    const label = labels[statut] || statut || 'Actif';
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}>
        {label}
      </span>
    );
  };

  if (authLoading || permsLoading || !hasPermission('menu_tenants')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>;
  }

  if (loading) {
    return <div className="p-8 text-center text-[#7a7365]">Chargement des entreprises...</div>;
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 relative pt-16 px-6 pb-10">

      {errorMsg && (
        <div className="bg-[#A35139]/10 border border-[#A35139]/30 text-[#A35139] px-4 py-3 rounded-xl">
          {errorMsg}
        </div>
      )}

      {/* En-tête */}
      <div className="bg-white p-6 shadow-sm rounded-xl border border-[#C9C1B1]/50 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2632]">Gestion des Entreprises</h1>
          <p className="text-sm text-[#7a7365] mt-1">Gérez les tenants et leurs administrateurs principaux.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-[#1B2632] hover:bg-[#2C3B4D] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
        >
          <span className="text-lg leading-none">+</span> Nouvelle Entreprise
        </button>
      </div>

      {/* Tableau des Tenants */}
      <div className="bg-white shadow-sm rounded-xl border border-[#C9C1B1]/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#3a3529]">
            <thead className="bg-[#EEE9DF]/60 text-[#7a7365] text-xs uppercase font-semibold border-b border-[#C9C1B1]/50">
              <tr>
                <th className="px-6 py-4">Nom de l'entreprise</th>
                <th className="px-6 py-4">ID Tenant</th>
                <th className="px-6 py-4">Date de création</th>
                <th className="px-6 py-4">Statut</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEE9DF]">
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-[#9a9384] italic">
                    Aucune entreprise trouvée.
                  </td>
                </tr>
              ) : (
                tenants.map((tenant) => {
                  const enCours = actionEnCours === tenant.id;
                  return (
                    <tr key={tenant.id} className="hover:bg-[#EEE9DF]/30 transition-colors">
                      <td className="px-6 py-4 font-bold text-[#1B2632]">
                        {tenant.nom_entreprise || 'Nom manquant'}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-[#9a9384]">{tenant.id}</td>
                      <td className="px-6 py-4">{formatDate(tenant.created_at)}</td>
                      <td className="px-6 py-4">{badgeStatut(tenant.statut)}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => ouvrirEdition(tenant)}
                            disabled={enCours}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-[#1B2632] hover:bg-[#EEE9DF] disabled:opacity-40 cursor-pointer"
                          >
                            Modifier
                          </button>
                          <button
                            onClick={() => toggleSuspension(tenant)}
                            disabled={enCours}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-[#A35139] hover:bg-[#A35139]/10 disabled:opacity-40 cursor-pointer"
                          >
                            {tenant.statut === 'suspendu' ? 'Réactiver' : 'Suspendre'}
                          </button>
                          <button
                            onClick={() => handleDeleteTenant(tenant)}
                            disabled={enCours}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-[#A35139] hover:bg-[#A35139]/10 disabled:opacity-40 cursor-pointer"
                          >
                            Supprimer
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
              <h3 className="font-bold text-[#1B2632] text-lg">Créer une nouvelle entreprise</h3>
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
                  Nom de l'entreprise ou partenaire *
                </label>
                <input
                  type="text"
                  placeholder="ex: FGMED Sénégal"
                  value={newTenantNom}
                  onChange={(e) => setNewTenantNom(e.target.value)}
                  className="w-full border border-[#C9C1B1] px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]/20 focus:border-[#1B2632]"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1B2632] mb-1">
                  Pays d'opération (optionnel pour l'instant)
                </label>
                <input
                  type="text"
                  placeholder="ex: Sénégal"
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
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Créer l'entreprise
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
              <h3 className="font-bold text-[#1B2632] text-lg">Modifier l'entreprise</h3>
              <button
                onClick={() => setEditTenant(null)}
                className="text-[#9a9384] hover:text-[#1B2632] transition-colors cursor-pointer text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleUpdateTenant} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#1B2632] mb-1">
                  Nom de l'entreprise *
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
                <label className="block text-sm font-semibold text-[#1B2632] mb-1">Statut</label>
                <select
                  value={editStatut}
                  onChange={(e) => setEditStatut(e.target.value)}
                  className="w-full border border-[#C9C1B1] px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]/20 focus:border-[#1B2632]"
                >
                  <option value="actif">Actif</option>
                  <option value="suspendu">Suspendu</option>
                  <option value="archive">Archivé</option>
                </select>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditTenant(null)}
                  className="flex-1 px-4 py-2.5 border border-[#C9C1B1] text-[#1B2632] rounded-lg text-sm font-medium hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}