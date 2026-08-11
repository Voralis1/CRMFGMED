"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../context/AuthContext"; // 👈 Conservé pour le tenantId et user
import { usePermissions } from "../context/PermissionsContext"; // 🚀 Import du contexte des permissions

export default function ParametresAdmin() {
  const { user, tenantId, loading: authLoading } = useAuth(); // 👈 On garde l'auth de base
  const { hasPermission, loading: permsLoading } = usePermissions(); // 🚀 Récupération des droits dynamiques
  const router = useRouter();
  
  const [ongletActif, setOngletActif] = useState("produits");
  const [chargement, setChargement] = useState(true);
  const [message, setMessage] = useState({ texte: "", type: "" });

  // États Pays
  const [listePays, setListePays] = useState([]);
  const [nouveauPays, setNouveauPays] = useState({ id: null, nom: "", code: "", devise: "" });
  const [isEditingPays, setIsEditingPays] = useState(false);

  // États Zones
  const [listeZones, setListeZones] = useState([]);
  const [nouvelleZone, setNouvelleZone] = useState({ id: null, nom_zone: "", frais_livraison: "", pays_id: "" });
  const [isEditingZone, setIsEditingZone] = useState(false);

  // États Statuts (avec pays_id)
  const [listeStatuts, setListeStatuts] = useState([]);
  const [nouveauStatut, setNouveauStatut] = useState({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "" });
  const [isEditingStatut, setIsEditingStatut] = useState(false);

  // États Produits
  const [listeProduits, setListeProduits] = useState([]);
  const [nouveauProduit, setNouveauProduit] = useState({
    seller: "",
    product: "",
    code: "",
    current_quantity: 0,
    defected_quantity: 0,
    price: "",
    upsell: "",
    product_page: ""
  });

  // 🚀 REDIRECTION SÉCURISÉE VIA LA MATRICE DE PERMISSIONS
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace("/");
      } else if (!hasPermission("menu_parametres")) {
        router.replace("/dashboard");
      } else if (tenantId) {
        chargerDonnees();
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, tenantId, router]);

  async function chargerDonnees() {
    if (!tenantId) return;
    setChargement(true);
    
    // Charger pays filtrés par tenant_id
    const { data: paysData } = await supabase.from("pays").select("*").eq("tenant_id", tenantId).order("nom");
    if (paysData) setListePays(paysData);

    // Charger zones filtrées par tenant_id
    const { data: zonesData } = await supabase
      .from("zones")
      .select("*, pays(nom, devise)")
      .eq("tenant_id", tenantId)
      .order("nom_zone");
    if (zonesData) setListeZones(zonesData);

    // Charger statuts filtrés par tenant_id
    const { data: statutsData } = await supabase
      .from("statuts")
      .select("*, pays(nom)")
      .eq("tenant_id", tenantId)
      .order("nom");
    if (statutsData) setListeStatuts(statutsData);

    // Charger produits filtrés par tenant_id
    const { data: produitsData } = await supabase.from("produits").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (produitsData) setListeProduits(produitsData);

    setChargement(false);
  }

  // --- ACTIONS PAYS ---
  async function ajouterPays(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauPays.nom || !nouveauPays.code || !nouveauPays.devise) {
      afficherMessage("Tous les champs du pays sont obligatoires.", "erreur");
      return;
    }

    if (isEditingPays) {
      const { error } = await supabase.from("pays").update({
        nom: nouveauPays.nom.trim(),
        code: nouveauPays.code.trim().toUpperCase(),
        devise: nouveauPays.devise.trim().toUpperCase()
      }).eq("id", nouveauPays.id).eq("tenant_id", tenantId);

      if (error) {
        afficherMessage("Erreur lors de la modification du pays.", "erreur");
      } else {
        afficherMessage("Pays modifié avec succès.", "succes");
        annulerEditionPays();
        chargerDonnees();
      }
    } else {
      const { error } = await supabase.from("pays").insert([{
        nom: nouveauPays.nom.trim(),
        code: nouveauPays.code.trim().toUpperCase(),
        devise: nouveauPays.devise.trim().toUpperCase(),
        tenant_id: tenantId
      }]);

      if (error) {
        afficherMessage("Erreur lors de l'ajout du pays.", "erreur");
      } else {
        afficherMessage("Pays ajouté avec succès.", "succes");
        setNouveauPays({ id: null, nom: "", code: "", devise: "" });
        chargerDonnees();
      }
    }
  }

  function preparerModificationPays(pays) {
    setNouveauPays({
      id: pays.id,
      nom: pays.nom || "",
      code: pays.code || "",
      devise: pays.devise || ""
    });
    setIsEditingPays(true);
  }

  function annulerEditionPays() {
    setNouveauPays({ id: null, nom: "", code: "", devise: "" });
    setIsEditingPays(false);
  }

  async function supprimerPays(id, nom) {
    if (!tenantId) return;
    if (!window.confirm(`Supprimer ${nom} ?`)) return;
    const { error } = await supabase.from("pays").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) {
      afficherMessage("Impossible de supprimer ce pays.", "erreur");
    } else {
      afficherMessage("Pays supprimé.", "succes");
      chargerDonnees();
    }
  }

  // --- ACTIONS ZONES ---
  async function ajouterZone(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouvelleZone.nom_zone || !nouvelleZone.frais_livraison || !nouvelleZone.pays_id) {
      afficherMessage("Tous les champs de la zone sont obligatoires.", "erreur");
      return;
    }

    if (isEditingZone) {
      const { error } = await supabase.from("zones").update({
        nom_zone: nouvelleZone.nom_zone.trim(),
        frais_livraison: parseFloat(nouvelleZone.frais_livraison),
        pays_id: nouvelleZone.pays_id
      }).eq("id", nouvelleZone.id).eq("tenant_id", tenantId);

      if (error) {
        afficherMessage("Erreur lors de la modification de la zone.", "erreur");
      } else {
        afficherMessage("Zone de livraison modifiée avec succès.", "succes");
        annulerEditionZone();
        chargerDonnees();
      }
    } else {
      const { error } = await supabase.from("zones").insert([{
        nom_zone: nouvelleZone.nom_zone.trim(),
        frais_livraison: parseFloat(nouvelleZone.frais_livraison),
        pays_id: nouvelleZone.pays_id,
        tenant_id: tenantId
      }]);

      if (error) {
        afficherMessage("Erreur lors de l'ajout de la zone.", "erreur");
      } else {
        afficherMessage("Zone de livraison ajoutée avec succès.", "succes");
        setNouvelleZone({ id: null, nom_zone: "", frais_livraison: "", pays_id: "" });
        chargerDonnees();
      }
    }
  }

  function preparerModificationZone(zone) {
    setNouvelleZone({
      id: zone.id,
      nom_zone: zone.nom_zone || "",
      frais_livraison: zone.frais_livraison || "",
      pays_id: zone.pays_id || ""
    });
    setIsEditingZone(true);
  }

  function annulerEditionZone() {
    setNouvelleZone({ id: null, nom_zone: "", frais_livraison: "", pays_id: "" });
    setIsEditingZone(false);
  }

  async function supprimerZone(id) {
    if (!tenantId) return;
    if (!window.confirm("Supprimer cette zone ?")) return;
    const { error } = await supabase.from("zones").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) {
      afficherMessage("Erreur lors de la suppression.", "erreur");
    } else {
      afficherMessage("Zone supprimée.", "succes");
      chargerDonnees();
    }
  }

  // --- ACTIONS STATUTS ---
  async function ajouterStatut(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauStatut.nom || !nouveauStatut.pays_id) {
      afficherMessage("Le nom du statut et le pays sont obligatoires.", "erreur");
      return;
    }

    if (isEditingStatut) {
      const { error } = await supabase.from("statuts").update({
        nom: nouveauStatut.nom.trim(),
        couleur: nouveauStatut.couleur,
        pays_id: nouveauStatut.pays_id
      }).eq("id", nouveauStatut.id).eq("tenant_id", tenantId);

      if (error) {
        afficherMessage("Erreur lors de la modification du statut.", "erreur");
      } else {
        afficherMessage("Statut modifié avec succès.", "succes");
        annulerEditionStatut();
        chargerDonnees();
      }
    } else {
      const { error } = await supabase.from("statuts").insert([{
        nom: nouveauStatut.nom.trim(),
        couleur: nouveauStatut.couleur,
        pays_id: nouveauStatut.pays_id,
        tenant_id: tenantId
      }]);

      if (error) {
        afficherMessage("Erreur lors de l'ajout du statut.", "erreur");
      } else {
        afficherMessage("Statut ajouté avec succès.", "succes");
        setNouveauStatut({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "" });
        chargerDonnees();
      }
    }
  }

  function preparerModificationStatut(statut) {
    setNouveauStatut({
      id: statut.id,
      nom: statut.nom || "",
      couleur: statut.couleur || "#2C3B4D",
      pays_id: statut.pays_id || ""
    });
    setIsEditingStatut(true);
  }

  function annulerEditionStatut() {
    setNouveauStatut({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "" });
    setIsEditingStatut(false);
  }

  async function supprimerStatut(id) {
    if (!tenantId) return;
    if (!window.confirm("Supprimer ce statut ?")) return;
    const { error } = await supabase.from("statuts").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) {
      afficherMessage("Erreur lors de la suppression.", "erreur");
    } else {
      afficherMessage("Statut supprimé.", "succes");
      chargerDonnees();
    }
  }

  // --- ACTIONS PRODUITS ---
  async function ajouterProduit(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauProduit.product || !nouveauProduit.price) {
      afficherMessage("Le nom du produit et le prix sont obligatoires.", "erreur");
      return;
    }

    const { error } = await supabase.from("produits").insert([{
      seller: nouveauProduit.seller.trim(),
      product: nouveauProduit.product.trim(),
      code: nouveauProduit.code.trim(),
      current_quantity: parseInt(nouveauProduit.current_quantity) || 0,
      defected_quantity: parseInt(nouveauProduit.defected_quantity) || 0,
      price: parseFloat(nouveauProduit.price) || 0,
      upsell: nouveauProduit.upsell.trim(),
      product_page: nouveauProduit.product_page.trim(),
      tenant_id: tenantId
    }]);

    if (error) {
      afficherMessage("Erreur lors de l'ajout du produit : " + error.message, "erreur");
    } else {
      afficherMessage("Produit ajouté avec succès.", "succes");
      setNouveauProduit({
        seller: "",
        product: "",
        code: "",
        current_quantity: 0,
        defected_quantity: 0,
        price: "",
        upsell: "",
        product_page: ""
      });
      chargerDonnees();
    }
  }

  async function supprimerProduit(id) {
    if (!tenantId) return;
    if (!window.confirm("Supprimer ce produit ?")) return;
    const { error } = await supabase.from("produits").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) {
      afficherMessage("Erreur lors de la suppression.", "erreur");
    } else {
      afficherMessage("Produit supprimé.", "succes");
      chargerDonnees();
    }
  }

  function afficherMessage(texte, type) {
    setMessage({ texte, type });
    setTimeout(() => setMessage({ texte: "", type: "" }), 5000);
  }

  const TabButton = ({ id, label, icon }) => (
    <button 
      onClick={() => setOngletActif(id)}
      className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center gap-2 cursor-pointer ${
        ongletActif === id 
          ? 'bg-[#1B2632] text-white shadow-md' 
          : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
      }`}
    >
      <span>{icon}</span>
      {label}
    </button>
  );

  // 🚀 Écran de chargement et de vérification sécurisée
  if (authLoading || permsLoading || !hasPermission("menu_parametres")) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>;
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-16 px-6">
      <StyleParametres />

      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
            Administration
          </p>
          <h1 className="text-3xl font-bold text-[#1B2632]">Paramètres Généraux</h1>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-2 mt-2">
          <TabButton id="pays" label="Pays & Devises" />
          <TabButton id="zones" label="Zones de livraison" />
          <TabButton id="statuts" label="Statuts configurables" />
          <TabButton id="produits" label="Catalogue Produits" />
        </div>
      </header>

      {message.texte && (
        <div className={`p-4 rounded-xl text-sm font-semibold border ${message.type === 'succes' ? 'bg-[#d4edda] text-[#155724] border-[#c3e6cb]' : 'bg-[#f8d7da] text-[#721c24] border-[#f5c6cb]'}`}>
          {message.texte}
        </div>
      )}

      <main className="w-full">
        
        {/* --- ONGLET PAYS --- */}
        {ongletActif === "pays" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">
                  {isEditingPays ? "Modifier le pays" : "Gestion des pays d'opération"}
                </h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">Configurez les pays et leurs devises respectives.</p>
              </div>

              <form onSubmit={ajouterPays} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Nom du Pays</label>
                  <input type="text" placeholder="ex: Angola" value={nouveauPays.nom} onChange={(e) => setNouveauPays({...nouveauPays, nom: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Code ISO</label>
                  <input type="text" placeholder="ex: AO" maxLength={2} value={nouveauPays.code} onChange={(e) => setNouveauPays({...nouveauPays, code: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Devise</label>
                  <input type="text" placeholder="ex: AOA" maxLength={3} value={nouveauPays.devise} onChange={(e) => setNouveauPays({...nouveauPays, devise: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="fg-btn-primary w-full">
                    {isEditingPays ? "Mettre à jour" : "Ajouter le pays"}
                  </button>
                  {isEditingPays && (
                    <button type="button" onClick={annulerEditionPays} className="px-4 py-2 border border-[#C9C1B1] rounded-xl text-xs font-bold bg-white text-[#1B2632] hover:bg-gray-100 cursor-pointer">
                      Annuler
                    </button>
                  )}
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                <table className="fg-table w-full">
                  <thead>
                    <tr>
                      <th>Pays</th>
                      <th>Code ISO</th>
                      <th>Devise</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargement ? (
                      <tr><td colSpan="4" className="text-center py-6">Chargement...</td></tr>
                    ) : listePays.length === 0 ? (
                      <tr><td colSpan="4" className="text-center py-6 text-gray-400">Aucun pays configuré.</td></tr>
                    ) : (
                      listePays.map((p) => (
                        <tr key={p.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="font-medium">{p.nom}</td>
                          <td><span className="fg-badge">{p.code}</span></td>
                          <td><span className="fg-badge dark">{p.devise}</span></td>
                          <td className="text-right flex items-center justify-end gap-2">
                            <button onClick={() => preparerModificationPays(p)} className="px-3 py-1 bg-white border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] hover:bg-gray-50 cursor-pointer">
                              Modifier
                            </button>
                            <button onClick={() => supprimerPays(p.id, p.nom)} className="fg-btn-danger">Supprimer</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET ZONES DE LIVRAISON --- */}
        {ongletActif === "zones" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">
                  {isEditingZone ? "Modifier la zone de livraison" : "Zones et Tarifs de Livraison"}
                </h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">Associez chaque zone géographique à son tarif et à son pays.</p>
              </div>

              <form onSubmit={ajouterZone} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Pays rattaché</label>
                  <select value={nouvelleZone.pays_id} onChange={(e) => setNouvelleZone({...nouvelleZone, pays_id: e.target.value})} className="fg-input cursor-pointer" required>
                    <option value="">Sélectionner un pays</option>
                    {listePays.map((p) => (<option key={p.id} value={p.id}>{p.nom}</option>))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Nom de la zone</label>
                  <input type="text" placeholder="ex: Province Sud" value={nouvelleZone.nom_zone} onChange={(e) => setNouvelleZone({...nouvelleZone, nom_zone: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Frais de livraison</label>
                  <input type="number" placeholder="Montant" value={nouvelleZone.frais_livraison} onChange={(e) => setNouvelleZone({...nouvelleZone, frais_livraison: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="fg-btn-primary w-full">
                    {isEditingZone ? "Mettre à jour" : "Ajouter la zone"}
                  </button>
                  {isEditingZone && (
                    <button type="button" onClick={annulerEditionZone} className="px-4 py-2 border border-[#C9C1B1] rounded-xl text-xs font-bold bg-white text-[#1B2632] hover:bg-gray-100 cursor-pointer">
                      Annuler
                    </button>
                  )}
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                <table className="fg-table w-full">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      <th>Pays</th>
                      <th>Frais de livraison</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargement ? (
                      <tr><td colSpan="4" className="text-center py-6">Chargement...</td></tr>
                    ) : listeZones.length === 0 ? (
                      <tr><td colSpan="4" className="text-center py-6 text-gray-400">Aucune zone configurée.</td></tr>
                    ) : (
                      listeZones.map((z) => (
                        <tr key={z.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="font-medium">{z.nom_zone}</td>
                          <td><span className="fg-badge">{z.pays?.nom || 'N/A'}</span></td>
                          <td><span className="fg-badge dark">{z.frais_livraison} {z.pays?.devise}</span></td>
                          <td className="text-right flex items-center justify-end gap-2">
                            <button onClick={() => preparerModificationZone(z)} className="px-3 py-1 bg-white border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] hover:bg-gray-50 cursor-pointer">
                              Modifier
                            </button>
                            <button onClick={() => supprimerZone(z.id)} className="fg-btn-danger">Supprimer</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET STATUTS CONFIGURABLES --- */}
        {ongletActif === "statuts" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">
                  {isEditingStatut ? "Modifier le statut d'appel" : "Statuts d'appels configurables"}
                </h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">Gérez les différents états de qualification des appels rattachés à chaque pays.</p>
              </div>

              <form onSubmit={ajouterStatut} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Pays rattaché</label>
                  <select value={nouveauStatut.pays_id} onChange={(e) => setNouveauStatut({...nouveauStatut, pays_id: e.target.value})} className="fg-input cursor-pointer" required>
                    <option value="">Sélectionner un pays</option>
                    {listePays.map((p) => (<option key={p.id} value={p.id}>{p.nom}</option>))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Nom du statut</label>
                  <input type="text" placeholder="ex: Confirmé" value={nouveauStatut.nom} onChange={(e) => setNouveauStatut({...nouveauStatut, nom: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Couleur du badge</label>
                  <input type="color" value={nouveauStatut.couleur} onChange={(e) => setNouveauStatut({...nouveauStatut, couleur: e.target.value})} className="w-full h-[42px] border border-[#C9C1B1] rounded-xl cursor-pointer bg-white p-1" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="fg-btn-primary w-full">
                    {isEditingStatut ? "Mettre à jour" : "Ajouter le statut"}
                  </button>
                  {isEditingStatut && (
                    <button type="button" onClick={annulerEditionStatut} className="px-4 py-2 border border-[#C9C1B1] rounded-xl text-xs font-bold bg-white text-[#1B2632] hover:bg-gray-100 cursor-pointer">
                      Annuler
                    </button>
                  )}
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                <table className="fg-table w-full">
                  <thead>
                    <tr>
                      <th>Statut</th>
                      <th>Pays</th>
                      <th>Aperçu du Badge</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargement ? (
                      <tr><td colSpan="4" className="text-center py-6">Chargement...</td></tr>
                    ) : listeStatuts.length === 0 ? (
                      <tr><td colSpan="4" className="text-center py-6 text-gray-400">Aucun statut configuré.</td></tr>
                    ) : (
                      listeStatuts.map((s) => (
                        <tr key={s.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="font-medium">{s.nom}</td>
                          <td><span className="fg-badge">{s.pays?.nom || 'N/A'}</span></td>
                          <td>
                            <span className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: s.couleur, color: "#fff" }}>
                              {s.nom}
                            </span>
                          </td>
                          <td className="text-right flex items-center justify-end gap-2">
                            <button onClick={() => preparerModificationStatut(s)} className="px-3 py-1 bg-white border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] hover:bg-gray-50 cursor-pointer">
                              Modifier
                            </button>
                            <button onClick={() => supprimerStatut(s.id)} className="fg-btn-danger">Supprimer</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET CATALOGUE PRODUITS --- */}
        {ongletActif === "produits" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">Catalogue Produits</h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">Ajoutez et gérez les produits disponibles dans le système.</p>
              </div>

              <form onSubmit={ajouterProduit} className="flex flex-col gap-4 mb-8 p-6 bg-[#faf9f7] rounded-xl border border-dashed border-[#C9C1B1]">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Product Name *</label>
                    <input type="text" placeholder="Nom du produit" value={nouveauProduit.product} onChange={(e) => setNouveauProduit({...nouveauProduit, product: e.target.value})} className="fg-input" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Seller</label>
                    <input type="text" placeholder="Vendeur / Fournisseur" value={nouveauProduit.seller} onChange={(e) => setNouveauProduit({...nouveauProduit, seller: e.target.value})} className="fg-input" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Code</label>
                    <input type="text" placeholder="Référence" value={nouveauProduit.code} onChange={(e) => setNouveauProduit({...nouveauProduit, code: e.target.value})} className="fg-input" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Current Qty</label>
                    <input type="number" placeholder="0" value={nouveauProduit.current_quantity || ''} onChange={(e) => setNouveauProduit({...nouveauProduit, current_quantity: e.target.value})} className="fg-input" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Defected Qty</label>
                    <input type="number" placeholder="0" value={nouveauProduit.defected_quantity || ''} onChange={(e) => setNouveauProduit({...nouveauProduit, defected_quantity: e.target.value})} className="fg-input" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Price *</label>
                    <input type="number" step="0.01" placeholder="Montant" value={nouveauProduit.price} onChange={(e) => setNouveauProduit({...nouveauProduit, price: e.target.value})} className="fg-input" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Upsell</label>
                    <input type="text" placeholder="Produit additionnel" value={nouveauProduit.upsell} onChange={(e) => setNouveauProduit({...nouveauProduit, upsell: e.target.value})} className="fg-input" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Product Page URL</label>
                    <input type="text" placeholder="https://" value={nouveauProduit.product_page} onChange={(e) => setNouveauProduit({...nouveauProduit, product_page: e.target.value})} className="fg-input" />
                  </div>
                  <div>
                    <button type="submit" className="fg-btn-primary w-full">Ajouter le produit</button>
                  </div>
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                <table className="fg-table w-full whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="uppercase tracking-wider">ID</th>
                      <th className="uppercase tracking-wider">SELLER</th>
                      <th className="uppercase tracking-wider">PRODUCT</th>
                      <th className="uppercase tracking-wider">CODE</th>
                      <th className="uppercase tracking-wider text-center">CURRENT QTY</th>
                      <th className="uppercase tracking-wider text-center">DEFECTED QTY</th>
                      <th className="uppercase tracking-wider">PRICE</th>
                      <th className="uppercase tracking-wider">UPSELL</th>
                      <th className="uppercase tracking-wider">PAGE</th>
                      <th className="uppercase tracking-wider text-right">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#C9C1B1]/30">
                    {chargement ? (
                      <tr><td colSpan="10" className="text-center py-8 text-[#1B2632]/60">Chargement...</td></tr>
                    ) : listeProduits.length === 0 ? (
                      <tr><td colSpan="10" className="text-center py-8 font-medium text-[#1B2632]/70">Aucun produit configuré.</td></tr>
                    ) : (
                      listeProduits.map((pr) => (
                        <tr key={pr.id} className="hover:bg-[#EEE9DF]/20 transition-colors">
                          <td className="font-mono text-xs text-[#1B2632]/60">#{pr.id}</td>
                          <td className="text-sm font-medium">{pr.seller || '-'}</td>
                          <td className="font-bold text-[14px]">{pr.product}</td>
                          <td><span className="font-mono text-xs text-[#A35139] font-semibold">{pr.code || '-'}</span></td>
                          <td className="text-center"><span className="font-semibold">{pr.current_quantity ?? 0}</span></td>
                          <td className="text-center"><span className="font-semibold text-red-600">{pr.defected_quantity ?? 0}</span></td>
                          <td><span className="font-bold">{pr.price}</span></td>
                          <td className="text-sm text-[#1B2632]/80">{pr.upsell || '-'}</td>
                          <td>
                            {pr.product_page ? (
                              <a href={pr.product_page} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs font-semibold">
                                Link
                              </a>
                            ) : '-'}
                          </td>
                          <td className="text-right">
                            <button onClick={() => supprimerProduit(pr.id)} className="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1 cursor-pointer">Supprimer</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

function StyleParametres() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
      
      .fg-input{width:100%;padding:10px 14px;border-radius:10px;border:1px solid var(--oatmeal);font-family:'Inter';font-size:14px;outline:none;background:#fff;transition:0.2s;}
      .fg-input:focus{border-color:#1B2632;box-shadow:0 0 0 2px rgba(27,38,50,0.05);}
      
      .fg-btn-primary{background:#1B2632;color:#fff;border:none;padding:10px 20px;border-radius:10px;font-weight:600;cursor:pointer;transition:0.2s;white-space:nowrap;height:44px;}
      .fg-btn-primary:hover{background:#2C3B4D;}
      
      .fg-btn-danger{background:transparent;color:#A35139;border:1px solid rgba(163,81,57,0.3);padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;}
      .fg-btn-danger:hover{background:rgba(163,81,57,0.1);}
      
      .fg-table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;}
      .fg-table th{background:#EEE9DF30;padding:14px 20px;font-size:11px;font-weight:700;color:#1B263290;border-bottom:1px solid #C9C1B1;}
      .fg-table td{padding:14px 20px;border-bottom:1px solid #C9C1B150;color:#1B2632;}
      .fg-table tr:last-child td{border-bottom:none;}
      
      .fg-badge{display:inline-block;padding:4px 8px;border-radius:6px;background:#EEE9DF;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;}
      .fg-badge.dark{background:#1B2632;color:#fff;}
    `}</style>
  );
}