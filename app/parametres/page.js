"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../context/PermissionsContext";

export default function ParametresAdmin() {
  const { user, tenantId, loading: authLoading } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const router = useRouter();

  const [ongletActif, setOngletActif] = useState("produits");
  const [chargement, setChargement] = useState(true);
  const [message, setMessage] = useState({ texte: "", type: "" });

  // --- États Pays ---
  const [listePays, setListePays] = useState([]);
  const [nouveauPays, setNouveauPays] = useState({ id: null, nom: "", code: "", devise: "" });
  const [isEditingPays, setIsEditingPays] = useState(false);

  // --- États Zones ---
  const [listeZones, setListeZones] = useState([]);
  const [nouvelleZone, setNouvelleZone] = useState({ id: null, nom_zone: "", frais_livraison: "", pays_id: "" });
  const [isEditingZone, setIsEditingZone] = useState(false);

  // --- États Statuts ---
  const [listeStatuts, setListeStatuts] = useState([]);
  const [nouveauStatut, setNouveauStatut] = useState({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "", necessite_rappel: false, declenche_assignation: false });
  const [isEditingStatut, setIsEditingStatut] = useState(false);

  // --- États Produits ---
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

  // --- États Entrepôts ---
  const [listeEntrepots, setListeEntrepots] = useState([]);
  const [nouvelEntrepot, setNouvelEntrepot] = useState({ nom: "", localisation: "" });

  // --- États Stocks & Mouvements ---
  const [listeStocks, setListeStocks] = useState([]);
  const [nouveauMouvement, setNouveauMouvement] = useState({
    produit_id: "", entrepot_id: "", type_mouvement: "entree", quantite: 1, notes: ""
  });

  // --- REDIRECTION SÉCURISÉE ---
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

    const { data: paysData } = await supabase.from("pays").select("*").eq("tenant_id", tenantId).order("nom");
    if (paysData) setListePays(paysData);

    const { data: zonesData } = await supabase.from("zones").select("*, pays(nom, devise)").eq("tenant_id", tenantId).order("nom_zone");
    if (zonesData) setListeZones(zonesData);

    const { data: statutsData } = await supabase.from("statuts").select("*, pays(nom)").eq("tenant_id", tenantId).order("nom");
    if (statutsData) setListeStatuts(statutsData);

    const { data: produitsData } = await supabase.from("produits").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (produitsData) setListeProduits(produitsData);

    const { data: entrepotsData } = await supabase.from("entrepots").select("*").eq("tenant_id", tenantId).order("nom");
    if (entrepotsData) setListeEntrepots(entrepotsData);

    const { data: stocksData } = await supabase.from("stocks").select("*, produits(product, code), entrepots(nom)").eq("tenant_id", tenantId);
    if (stocksData) setListeStocks(stocksData);

    setChargement(false);
  }

  // =====================================================================
  // ACTIONS PAYS
  // =====================================================================
  async function ajouterPays(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauPays.nom || !nouveauPays.code || !nouveauPays.devise) return afficherMessage("Tous les champs du pays sont obligatoires.", "erreur");

    if (isEditingPays) {
      const { error } = await supabase.from("pays").update({ nom: nouveauPays.nom.trim(), code: nouveauPays.code.trim().toUpperCase(), devise: nouveauPays.devise.trim().toUpperCase() }).eq("id", nouveauPays.id).eq("tenant_id", tenantId);
      if (error) afficherMessage("Erreur lors de la modification.", "erreur");
      else { afficherMessage("Pays modifié.", "succes"); annulerEditionPays(); chargerDonnees(); }
    } else {
      const { error } = await supabase.from("pays").insert([{ nom: nouveauPays.nom.trim(), code: nouveauPays.code.trim().toUpperCase(), devise: nouveauPays.devise.trim().toUpperCase(), tenant_id: tenantId }]);
      if (error) afficherMessage("Erreur lors de l'ajout.", "erreur");
      else { afficherMessage("Pays ajouté.", "succes"); setNouveauPays({ id: null, nom: "", code: "", devise: "" }); chargerDonnees(); }
    }
  }

  function preparerModificationPays(pays) { setNouveauPays({ id: pays.id, nom: pays.nom || "", code: pays.code || "", devise: pays.devise || "" }); setIsEditingPays(true); }
  function annulerEditionPays() { setNouveauPays({ id: null, nom: "", code: "", devise: "" }); setIsEditingPays(false); }
  async function supprimerPays(id, nom) { if (!tenantId || !window.confirm(`Supprimer ${nom} ?`)) return; await supabase.from("pays").delete().eq("id", id).eq("tenant_id", tenantId); chargerDonnees(); }

  // =====================================================================
  // ACTIONS ZONES
  // =====================================================================
  async function ajouterZone(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouvelleZone.nom_zone || !nouvelleZone.frais_livraison || !nouvelleZone.pays_id) return afficherMessage("Tous les champs sont obligatoires.", "erreur");

    if (isEditingZone) {
      const { error } = await supabase.from("zones").update({ nom_zone: nouvelleZone.nom_zone.trim(), frais_livraison: parseFloat(nouvelleZone.frais_livraison), pays_id: nouvelleZone.pays_id }).eq("id", nouvelleZone.id).eq("tenant_id", tenantId);
      if (error) afficherMessage("Erreur lors de la modification.", "erreur");
      else { afficherMessage("Zone modifiée.", "succes"); annulerEditionZone(); chargerDonnees(); }
    } else {
      const { error } = await supabase.from("zones").insert([{ nom_zone: nouvelleZone.nom_zone.trim(), frais_livraison: parseFloat(nouvelleZone.frais_livraison), pays_id: nouvelleZone.pays_id, tenant_id: tenantId }]);
      if (error) afficherMessage("Erreur lors de l'ajout.", "erreur");
      else { afficherMessage("Zone ajoutée.", "succes"); setNouvelleZone({ id: null, nom_zone: "", frais_livraison: "", pays_id: "" }); chargerDonnees(); }
    }
  }

  function preparerModificationZone(zone) { setNouvelleZone({ id: zone.id, nom_zone: zone.nom_zone || "", frais_livraison: zone.frais_livraison || "", pays_id: zone.pays_id || "" }); setIsEditingZone(true); }
  function annulerEditionZone() { setNouvelleZone({ id: null, nom_zone: "", frais_livraison: "", pays_id: "" }); setIsEditingZone(false); }
  async function supprimerZone(id) { if (!tenantId || !window.confirm("Supprimer cette zone ?")) return; await supabase.from("zones").delete().eq("id", id).eq("tenant_id", tenantId); chargerDonnees(); }

  // =====================================================================
  // ACTIONS STATUTS
  // =====================================================================
  async function ajouterStatut(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauStatut.nom || !nouveauStatut.pays_id) return afficherMessage("Nom et pays obligatoires.", "erreur");

    if (isEditingStatut) {
      const { error } = await supabase.from("statuts").update({ nom: nouveauStatut.nom.trim(), couleur: nouveauStatut.couleur, pays_id: nouveauStatut.pays_id, necessite_rappel: nouveauStatut.necessite_rappel, declenche_assignation: nouveauStatut.declenche_assignation }).eq("id", nouveauStatut.id).eq("tenant_id", tenantId);
      if (error) afficherMessage("Erreur lors de la modification.", "erreur");
      else { afficherMessage("Statut modifié.", "succes"); annulerEditionStatut(); chargerDonnees(); }
    } else {
      const codeGenere = nouveauStatut.nom.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s_]/g, "").replace(/\s+/g, "_");
      const { error } = await supabase.from("statuts").insert([{ nom: nouveauStatut.nom.trim(), code: codeGenere, couleur: nouveauStatut.couleur, pays_id: nouveauStatut.pays_id, tenant_id: tenantId, necessite_rappel: nouveauStatut.necessite_rappel, declenche_assignation: nouveauStatut.declenche_assignation }]);
      if (error) afficherMessage("Erreur : " + error.message, "erreur");
      else { afficherMessage("Statut ajouté.", "succes"); setNouveauStatut({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "", necessite_rappel: false, declenche_assignation: false }); chargerDonnees(); }
    }
  }

  function preparerModificationStatut(statut) { setNouveauStatut({ id: statut.id, nom: statut.nom || "", couleur: statut.couleur || "#2C3B4D", pays_id: statut.pays_id || "", necessite_rappel: statut.necessite_rappel || false, declenche_assignation: statut.declenche_assignation || false }); setIsEditingStatut(true); }
  function annulerEditionStatut() { setNouveauStatut({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "", necessite_rappel: false, declenche_assignation: false }); setIsEditingStatut(false); }
  async function supprimerStatut(id) { if (!tenantId || !window.confirm("Supprimer ce statut ?")) return; await supabase.from("statuts").delete().eq("id", id).eq("tenant_id", tenantId); chargerDonnees(); }

  // =====================================================================
  // ACTIONS PRODUITS
  // =====================================================================
  async function ajouterProduit(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauProduit.product || !nouveauProduit.price) return afficherMessage("Nom et prix obligatoires.", "erreur");

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

    if (error) afficherMessage("Erreur : " + error.message, "erreur");
    else {
      afficherMessage("Produit ajouté.", "succes");
      setNouveauProduit({ seller: "", product: "", code: "", current_quantity: 0, defected_quantity: 0, price: "", upsell: "", product_page: "" });
      chargerDonnees();
    }
  }
  async function supprimerProduit(id) { if (!tenantId || !window.confirm("Supprimer ce produit ?")) return; await supabase.from("produits").delete().eq("id", id).eq("tenant_id", tenantId); chargerDonnees(); }

  // =====================================================================
  // ACTIONS ENTREPÔTS & MOUVEMENTS
  // =====================================================================
  async function ajouterEntrepot(e) {
    e.preventDefault();
    if (!tenantId || !nouvelEntrepot.nom) return;
    const { error } = await supabase.from("entrepots").insert([{ nom: nouvelEntrepot.nom.trim(), localisation: nouvelEntrepot.localisation.trim(), tenant_id: tenantId }]);
    if (error) afficherMessage("Erreur lors de l'ajout de l'entrepôt : " + error.message, "erreur");
    else { afficherMessage("Entrepôt ajouté avec succès.", "succes"); setNouvelEntrepot({ nom: "", localisation: "" }); chargerDonnees(); }
  }

  async function ajouterMouvement(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauMouvement.produit_id || !nouveauMouvement.entrepot_id) return afficherMessage("Produit et entrepôt obligatoires.", "erreur");

    const { error } = await supabase.from("mouvements_stock").insert([{
      ...nouveauMouvement,
      quantite: parseInt(nouveauMouvement.quantite),
      tenant_id: tenantId
    }]);

    if (error) afficherMessage("Erreur : " + error.message, "erreur");
    else {
      afficherMessage("Mouvement enregistré ! L'inventaire a été mis à jour.", "succes");
      setNouveauMouvement({ produit_id: "", entrepot_id: "", type_mouvement: "entree", quantite: 1, notes: "" });
      chargerDonnees();
    }
  }

  // --- UTILITAIRES ---
  function afficherMessage(texte, type) {
    setMessage({ texte, type });
    setTimeout(() => setMessage({ texte: "", type: "" }), 5000);
  }

  // --- ICÔNES DES ONGLETS ---
  const TAB_ICONS = {
    pays: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    zones: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>
      </svg>
    ),
    statuts: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
    produits: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    ),
    entrepots: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/><path d="M3 21h18"/>
      </svg>
    ),
    stocks: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    ),
  };

  // --- BOUTON ONGLET (style pilule) ---
  const TabButton = ({ id, label }) => (
    <button
      onClick={() => setOngletActif(id)}
      className={`flex items-center gap-3 px-7 py-3.5 rounded-full text-left transition-all duration-200 cursor-pointer whitespace-nowrap border ${
        ongletActif === id
          ? "bg-[#1B2632] text-white border-[#1B2632] shadow-lg shadow-[#1B2632]/20 scale-[1.02]"
          : "bg-white text-[#1B2632] border-[#C9C1B1]/70 hover:border-[#1B2632]/40 hover:shadow-md hover:-translate-y-0.5"
      }`}
    >
      <span className={`shrink-0 ${ongletActif === id ? "text-[#FFB162]" : "text-[#A35139]"}`}>
        {TAB_ICONS[id]}
      </span>
      <span className="font-semibold text-[15px] leading-tight">{label}</span>
    </button>
  );

  // --- ÉCRAN DE CHARGEMENT ---
  if (authLoading || permsLoading || !hasPermission("menu_parametres")) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>;
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-16 px-6">
      <StyleParametres />

      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">Administration</p>
          <h1 className="text-3xl font-bold text-[#1B2632]">Paramètres Généraux</h1>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-3 pt-2 mt-2 tab-scroll">
          <TabButton id="pays" label="Pays & Devises" />
          <TabButton id="zones" label="Zones de livraison" />
          <TabButton id="statuts" label="Statuts configurables" />
          <TabButton id="produits" label="Catalogue Produits" />
          <TabButton id="entrepots" label="Entrepôts" />
          <TabButton id="stocks" label="Mouvements de Stock" />
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

              <form onSubmit={ajouterStatut} className="flex flex-col gap-4 mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
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
                </div>

                <div className="flex flex-wrap gap-6 pt-4 mt-2 border-t border-[#C9C1B1]/40">
                  <label className="flex items-start gap-2.5 cursor-pointer max-w-sm">
                    <input type="checkbox" checked={nouveauStatut.necessite_rappel} onChange={(e) => setNouveauStatut({...nouveauStatut, necessite_rappel: e.target.checked})} className="mt-0.5 w-4 h-4 accent-[#1B2632] cursor-pointer" />
                    <span>
                      <span className="block text-sm font-bold text-[#1B2632]">Nécessite une date de rappel</span>
                      <span className="block text-xs text-[#1B2632]/60">Affiche le champ date/heure dans le Centre d'appel.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer max-w-sm">
                    <input type="checkbox" checked={nouveauStatut.declenche_assignation} onChange={(e) => setNouveauStatut({...nouveauStatut, declenche_assignation: e.target.checked})} className="mt-0.5 w-4 h-4 accent-[#1B2632] cursor-pointer" />
                    <span>
                      <span className="block text-sm font-bold text-[#1B2632]">Déclenche l'assignation livreur</span>
                      <span className="block text-xs text-[#1B2632]/60">La commande ira en assignation logistique.</span>
                    </span>
                  </label>
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                <table className="fg-table w-full">
                  <thead>
                    <tr>
                      <th>Statut</th>
                      <th>Code</th>
                      <th>Pays</th>
                      <th>Badge</th>
                      <th className="text-center">Rappel</th>
                      <th className="text-center">Assignation</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargement ? (
                      <tr><td colSpan="7" className="text-center py-6">Chargement...</td></tr>
                    ) : listeStatuts.length === 0 ? (
                      <tr><td colSpan="7" className="text-center py-6 text-gray-400">Aucun statut configuré.</td></tr>
                    ) : (
                      listeStatuts.map((s) => (
                        <tr key={s.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="font-medium">{s.nom}</td>
                          <td><span className="font-mono text-xs text-[#1B2632]/50">{s.code}</span></td>
                          <td><span className="fg-badge">{s.pays?.nom || 'N/A'}</span></td>
                          <td><span className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: s.couleur, color: "#fff" }}>{s.nom}</span></td>
                          <td className="text-center">{s.necessite_rappel ? <span className="text-[#FFB162] font-bold">●</span> : "—"}</td>
                          <td className="text-center">{s.declenche_assignation ? <span className="text-[#2C3B4D] font-bold">●</span> : "—"}</td>
                          <td className="text-right flex items-center justify-end gap-2">
                            <button onClick={() => preparerModificationStatut(s)} className="px-3 py-1 bg-white border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] hover:bg-gray-50 cursor-pointer">Modifier</button>
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

        {/* --- ONGLET PRODUITS --- */}
        {ongletActif === "produits" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">Catalogue Produits</h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">Gérez vos produits. Les stocks globaux s'actualiseront via vos déclarations de mouvements.</p>
              </div>

              <form onSubmit={ajouterProduit} className="flex flex-col gap-4 mb-8 p-6 bg-[#faf9f7] rounded-xl border border-dashed border-[#C9C1B1]">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Product Name *</label>
                    <input type="text" value={nouveauProduit.product} onChange={(e) => setNouveauProduit({...nouveauProduit, product: e.target.value})} className="fg-input" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Seller</label>
                    <input type="text" value={nouveauProduit.seller} onChange={(e) => setNouveauProduit({...nouveauProduit, seller: e.target.value})} className="fg-input" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Code (SKU)</label>
                    <input type="text" value={nouveauProduit.code} onChange={(e) => setNouveauProduit({...nouveauProduit, code: e.target.value})} className="fg-input font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Initial Qty</label>
                    <input type="number" value={nouveauProduit.current_quantity || ''} onChange={(e) => setNouveauProduit({...nouveauProduit, current_quantity: e.target.value})} className="fg-input" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Defected Qty</label>
                    <input type="number" value={nouveauProduit.defected_quantity || ''} onChange={(e) => setNouveauProduit({...nouveauProduit, defected_quantity: e.target.value})} className="fg-input" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Price *</label>
                    <input type="number" step="0.01" value={nouveauProduit.price} onChange={(e) => setNouveauProduit({...nouveauProduit, price: e.target.value})} className="fg-input" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Upsell</label>
                    <input type="text" value={nouveauProduit.upsell} onChange={(e) => setNouveauProduit({...nouveauProduit, upsell: e.target.value})} className="fg-input" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Product Page URL</label>
                    <input type="text" value={nouveauProduit.product_page} onChange={(e) => setNouveauProduit({...nouveauProduit, product_page: e.target.value})} className="fg-input" />
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
                      <th>PRODUCT</th>
                      <th>CODE</th>
                      <th className="text-center">QTY</th>
                      <th className="text-center">DEFECTED</th>
                      <th>PRICE</th>
                      <th className="text-right">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#C9C1B1]/30">
                    {chargement ? (
                      <tr><td colSpan="6" className="text-center py-8">Chargement...</td></tr>
                    ) : listeProduits.length === 0 ? (
                      <tr><td colSpan="6" className="text-center py-8">Aucun produit configuré.</td></tr>
                    ) : (
                      listeProduits.map((pr) => (
                        <tr key={pr.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="font-bold text-[14px]">{pr.product}</td>
                          <td><span className="font-mono text-xs text-[#A35139] font-semibold">{pr.code || '-'}</span></td>
                          <td className="text-center font-semibold">{pr.current_quantity ?? 0}</td>
                          <td className="text-center font-semibold text-red-600">{pr.defected_quantity ?? 0}</td>
                          <td><span className="font-bold">{pr.price}</span></td>
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

        {/* --- ONGLET ENTREPÔTS --- */}
        {ongletActif === "entrepots" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">Gestion des Entrepôts</h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">Déclarez vos lieux de stockage physiques.</p>
              </div>

              <form onSubmit={ajouterEntrepot} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Nom de l'entrepôt</label>
                  <input type="text" placeholder="ex: Dépôt Principal Casa" value={nouvelEntrepot.nom} onChange={(e) => setNouvelEntrepot({...nouvelEntrepot, nom: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Localisation / Ville</label>
                  <input type="text" placeholder="ex: Casablanca" value={nouvelEntrepot.localisation} onChange={(e) => setNouvelEntrepot({...nouvelEntrepot, localisation: e.target.value})} className="fg-input" />
                </div>
                <div>
                  <button type="submit" className="fg-btn-primary w-full">Ajouter l'entrepôt</button>
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                <table className="fg-table w-full">
                  <thead>
                    <tr><th>Nom de l'entrepôt</th><th>Localisation</th><th className="text-center">Statut</th></tr>
                  </thead>
                  <tbody>
                    {listeEntrepots.length === 0 && <tr><td colSpan="3" className="text-center py-6 text-gray-400">Aucun entrepôt.</td></tr>}
                    {listeEntrepots.map((e) => (
                      <tr key={e.id} className="hover:bg-[#EEE9DF]/20">
                        <td className="font-bold text-[#1B2632]">{e.nom}</td>
                        <td className="text-gray-600">{e.localisation || '-'}</td>
                        <td className="text-center"><span className="fg-badge dark">Actif</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET STOCKS & MOUVEMENTS (style harmonisé avec le reste de la page) --- */}
        {ongletActif === "stocks" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">Inventaire et Mouvements</h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">Déclarez vos mouvements ici. Le stock du produit se met à jour automatiquement.</p>
              </div>

              {/* Même fond neutre en pointillés que tous les autres formulaires de la page */}
              <form onSubmit={ajouterMouvement} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Produit</label>
                  <select required value={nouveauMouvement.produit_id} onChange={(e) => setNouveauMouvement({...nouveauMouvement, produit_id: e.target.value})} className="fg-input cursor-pointer">
                    <option value="">Sélectionner un produit</option>
                    {listeProduits.map((p) => (<option key={p.id} value={p.id}>{p.product} ({p.code})</option>))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Entrepôt cible</label>
                  <select required value={nouveauMouvement.entrepot_id} onChange={(e) => setNouveauMouvement({...nouveauMouvement, entrepot_id: e.target.value})} className="fg-input cursor-pointer">
                    <option value="">Sélectionner un entrepôt</option>
                    {listeEntrepots.map((e) => (<option key={e.id} value={e.id}>{e.nom}</option>))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Nature de l'opération</label>
                  <select required value={nouveauMouvement.type_mouvement} onChange={(e) => setNouveauMouvement({...nouveauMouvement, type_mouvement: e.target.value})} className="fg-input cursor-pointer">
                    <option value="entree">Entrée (Réception / Fournisseur)</option>
                    <option value="sortie">Sortie (Perte / Autre)</option>
                    <option value="retour_ok">Retour Client (Remis en stock)</option>
                    <option value="retour_defaut">Retour Client (Défectueux)</option>
                    <option value="ajustement">Ajustement inventaire (+)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">Quantité</label>
                  <input type="number" min="1" required value={nouveauMouvement.quantite} onChange={(e) => setNouveauMouvement({...nouveauMouvement, quantite: e.target.value})} className="fg-input" />
                </div>

                {/* Bouton dans sa propre colonne, même hauteur (44px) et même couleur primaire que partout ailleurs */}
                <div className="flex gap-2">
                  <button type="submit" className="fg-btn-primary w-full">Valider le mouvement</button>
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                <table className="fg-table w-full">
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th>SKU</th>
                      <th>Entrepôt</th>
                      <th className="text-right">Disponible</th>
                      <th className="text-right">Défectueux</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listeStocks.length === 0 && <tr><td colSpan="5" className="text-center py-6 text-gray-400">Aucun stock. Ajoutez un mouvement pour commencer.</td></tr>}
                    {listeStocks.map((s) => (
                      <tr key={s.id} className="hover:bg-[#EEE9DF]/20">
                        <td className="font-bold text-[#1B2632]">{s.produits?.product}</td>
                        <td><span className="font-mono text-xs text-[#A35139] font-semibold">{s.produits?.code}</span></td>
                        <td className="font-medium text-gray-700">{s.entrepots?.nom}</td>
                        <td className="text-right font-bold text-[#1B2632]">{s.quantite_disponible}</td>
                        <td className="text-right font-semibold text-red-600">{s.quantite_defectueuse}</td>
                      </tr>
                    ))}
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

      .tab-scroll::-webkit-scrollbar{height:6px;}
      .tab-scroll::-webkit-scrollbar-track{background:transparent;}
      .tab-scroll::-webkit-scrollbar-thumb{background:#C9C1B1;border-radius:99px;}
      .tab-scroll::-webkit-scrollbar-thumb:hover{background:#A35139;}
    `}</style>
  );
}