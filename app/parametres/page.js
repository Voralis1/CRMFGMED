"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function ParametresAdmin() {
  const router = useRouter();
  
  const [ongletActif, setOngletActif] = useState("pays");
  const [chargement, setChargement] = useState(true);
  const [message, setMessage] = useState({ texte: "", type: "" });

  // États Pays
  const [listePays, setListePays] = useState([]);
  const [nouveauPays, setNouveauPays] = useState({ nom: "", code: "", devise: "" });

  // États Zones
  const [listeZones, setListeZones] = useState([]);
  const [nouvelleZone, setNouvelleZone] = useState({ nom_zone: "", frais_livraison: "", pays_id: "" });

  // États Statuts (avec pays_id)
  const [listeStatuts, setListeStatuts] = useState([]);
  const [nouveauStatut, setNouveauStatut] = useState({ nom: "", couleur: "#2C3B4D", pays_id: "" });

  // États Produits
  const [listeProduits, setListeProduits] = useState([]);
  const [nouveauProduit, setNouveauProduit] = useState({ nom: "", prix: "", description: "" });

  useEffect(() => {
    verifierAcces();
    chargerDonnees();
  }, []);

  async function verifierAcces() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.push("/");

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (roleData?.role !== "admin") {
      router.push("/");
    }
  }

  async function chargerDonnees() {
    setChargement(true);
    
    // Charger pays
    const { data: paysData } = await supabase.from("pays").select("*").order("nom");
    if (paysData) setListePays(paysData);

    // Charger zones
    const { data: zonesData } = await supabase
      .from("zones")
      .select("*, pays(nom, devise)")
      .order("nom_zone");
    if (zonesData) setListeZones(zonesData);

    // Charger statuts avec la relation pays
    const { data: statutsData } = await supabase
      .from("statuts")
      .select("*, pays(nom)")
      .order("nom");
    if (statutsData) setListeStatuts(statutsData);

    // Charger produits
    const { data: produitsData } = await supabase.from("produits").select("*").order("nom");
    if (produitsData) setListeProduits(produitsData);

    setChargement(false);
  }

  // --- ACTIONS PAYS ---
  async function ajouterPays(e) {
    e.preventDefault();
    if (!nouveauPays.nom || !nouveauPays.code || !nouveauPays.devise) {
      afficherMessage("Tous les champs du pays sont obligatoires.", "erreur");
      return;
    }

    const { error } = await supabase.from("pays").insert([{
      nom: nouveauPays.nom.trim(),
      code: nouveauPays.code.trim().toUpperCase(),
      devise: nouveauPays.devise.trim().toUpperCase()
    }]);

    if (error) {
      afficherMessage("Erreur lors de l'ajout du pays.", "erreur");
    } else {
      afficherMessage("Pays ajouté avec succès.", "succes");
      setNouveauPays({ nom: "", code: "", devise: "" });
      chargerDonnees();
    }
  }

  async function supprimerPays(id, nom) {
    if (!window.confirm(`Supprimer ${nom} ?`)) return;
    const { error } = await supabase.from("pays").delete().eq("id", id);
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
    if (!nouvelleZone.nom_zone || !nouvelleZone.frais_livraison || !nouvelleZone.pays_id) {
      afficherMessage("Tous les champs de la zone sont obligatoires.", "erreur");
      return;
    }

    const { error } = await supabase.from("zones").insert([{
      nom_zone: nouvelleZone.nom_zone.trim(),
      frais_livraison: parseFloat(nouvelleZone.frais_livraison),
      pays_id: nouvelleZone.pays_id
    }]);

    if (error) {
      afficherMessage("Erreur lors de l'ajout de la zone.", "erreur");
    } else {
      afficherMessage("Zone de livraison ajoutée avec succès.", "succes");
      setNouvelleZone({ nom_zone: "", frais_livraison: "", pays_id: "" });
      chargerDonnees();
    }
  }

  async function supprimerZone(id) {
    if (!window.confirm("Supprimer cette zone ?")) return;
    const { error } = await supabase.from("zones").delete().eq("id", id);
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
    if (!nouveauStatut.nom || !nouveauStatut.pays_id) {
      afficherMessage("Le nom du statut et le pays sont obligatoires.", "erreur");
      return;
    }

    const { error } = await supabase.from("statuts").insert([{
      nom: nouveauStatut.nom.trim(),
      couleur: nouveauStatut.couleur,
      pays_id: nouveauStatut.pays_id
    }]);

    if (error) {
      afficherMessage("Erreur lors de l'ajout du statut.", "erreur");
    } else {
      afficherMessage("Statut ajouté avec succès.", "succes");
      setNouveauStatut({ nom: "", couleur: "#2C3B4D", pays_id: "" });
      chargerDonnees();
    }
  }

  async function supprimerStatut(id) {
    if (!window.confirm("Supprimer ce statut ?")) return;
    const { error } = await supabase.from("statuts").delete().eq("id", id);
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
    if (!nouveauProduit.nom || !nouveauProduit.prix) {
      afficherMessage("Le nom et le prix du produit sont obligatoires.", "erreur");
      return;
    }

    const { error } = await supabase.from("produits").insert([{
      nom: nouveauProduit.nom.trim(),
      prix: parseFloat(nouveauProduit.prix),
      description: nouveauProduit.description.trim()
    }]);

    if (error) {
      afficherMessage("Erreur lors de l'ajout du produit.", "erreur");
    } else {
      afficherMessage("Produit ajouté avec succès.", "succes");
      setNouveauProduit({ nom: "", prix: "", description: "" });
      chargerDonnees();
    }
  }

  async function supprimerProduit(id) {
    if (!window.confirm("Supprimer ce produit ?")) return;
    const { error } = await supabase.from("produits").delete().eq("id", id);
    if (error) {
      afficherMessage("Erreur lors de la suppression.", "erreur");
    } else {
      afficherMessage("Produit supprimé.", "succes");
      chargerDonnees();
    }
  }

  function afficherMessage(texte, type) {
    setMessage({ texte, type });
    setTimeout(() => setMessage({ texte: "", type: "" }), 4000);
  }

  return (
    <div className="fg-root">
      <StyleParametres />

      <header className="fg-head">
        <div>
          <p className="fg-eyebrow">Administration</p>
          <h1 className="fg-title">Paramètres Généraux</h1>
        </div>
      </header>

      {message.texte && (
        <div className={`fg-alerte ${message.type}`}>{message.texte}</div>
      )}

      <div className="fg-layout">
        {/* Navigation par onglets */}
        <aside className="fg-sidebar">
          <button className={`fg-tab ${ongletActif === "pays" ? "actif" : ""}`} onClick={() => setOngletActif("pays")}>
            🌍 Pays & Devises
          </button>
          <button className={`fg-tab ${ongletActif === "zones" ? "actif" : ""}`} onClick={() => setOngletActif("zones")}>
            📍 Zones de livraison
          </button>
          <button className={`fg-tab ${ongletActif === "statuts" ? "actif" : ""}`} onClick={() => setOngletActif("statuts")}>
            🏷️ Statuts configurables
          </button>
          <button className={`fg-tab ${ongletActif === "produits" ? "actif" : ""}`} onClick={() => setOngletActif("produits")}>
            📦 Catalogue Produits
          </button>
        </aside>

        {/* Contenu */}
        <main className="fg-content">
          
          {/* --- ONGLET PAYS --- */}
          {ongletActif === "pays" && (
            <div className="fg-card">
              <div className="fg-card-head">
                <h2 className="fg-card-title">Gestion des pays d'opération</h2>
                <p className="fg-card-sub">Configurez les pays et leurs devises respectives.</p>
              </div>

              <form className="fg-form-grid" onSubmit={ajouterPays}>
                <input 
                  type="text" placeholder="Nom (ex: Angola)" 
                  value={nouveauPays.nom}
                  onChange={(e) => setNouveauPays({...nouveauPays, nom: e.target.value})}
                  className="fg-input"
                />
                <input 
                  type="text" placeholder="Code (ex: AO)" maxLength={2}
                  value={nouveauPays.code}
                  onChange={(e) => setNouveauPays({...nouveauPays, code: e.target.value})}
                  className="fg-input"
                />
                <input 
                  type="text" placeholder="Devise (ex: AOA)" maxLength={3}
                  value={nouveauPays.devise}
                  onChange={(e) => setNouveauPays({...nouveauPays, devise: e.target.value})}
                  className="fg-input"
                />
                <button type="submit" className="fg-btn-primary">Ajouter</button>
              </form>

              <div className="fg-table-wrap">
                <table className="fg-table">
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
                      <tr><td colSpan="4" className="text-center">Chargement...</td></tr>
                    ) : listePays.length === 0 ? (
                      <tr><td colSpan="4" className="text-center text-gray-400">Aucun pays configuré.</td></tr>
                    ) : (
                      listePays.map((p) => (
                        <tr key={p.id}>
                          <td className="font-medium">{p.nom}</td>
                          <td><span className="fg-badge">{p.code}</span></td>
                          <td><span className="fg-badge dark">{p.devise}</span></td>
                          <td className="text-right">
                            <button onClick={() => supprimerPays(p.id, p.nom)} className="fg-btn-danger">Supprimer</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* --- ONGLET ZONES DE LIVRAISON --- */}
          {ongletActif === "zones" && (
            <div className="fg-card">
              <div className="fg-card-head">
                <h2 className="fg-card-title">Zones et Tarifs de Livraison</h2>
                <p className="fg-card-sub">Associez chaque zone géographique à son tarif et à son pays.</p>
              </div>

              <form className="fg-form-grid" onSubmit={ajouterZone}>
                <select 
                  value={nouvelleZone.pays_id}
                  onChange={(e) => setNouvelleZone({...nouvelleZone, pays_id: e.target.value})}
                  className="fg-input"
                >
                  <option value="">Sélectionner un pays</option>
                  {listePays.map((p) => (
                    <option key={p.id} value={p.id}>{p.nom}</option>
                  ))}
                </select>

                <input 
                  type="text" placeholder="Nom de la zone (ex: ZONA 1)" 
                  value={nouvelleZone.nom_zone}
                  onChange={(e) => setNouvelleZone({...nouvelleZone, nom_zone: e.target.value})}
                  className="fg-input"
                />
                
                <input 
                  type="number" placeholder="Frais de livraison" 
                  value={nouvelleZone.frais_livraison}
                  onChange={(e) => setNouvelleZone({...nouvelleZone, frais_livraison: e.target.value})}
                  className="fg-input"
                />

                <button type="submit" className="fg-btn-primary">Ajouter</button>
              </form>

              <div className="fg-table-wrap">
                <table className="fg-table">
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
                      <tr><td colSpan="4" className="text-center">Chargement...</td></tr>
                    ) : listeZones.length === 0 ? (
                      <tr><td colSpan="4" className="text-center text-gray-400">Aucune zone configurée.</td></tr>
                    ) : (
                      listeZones.map((z) => (
                        <tr key={z.id}>
                          <td className="font-medium">{z.nom_zone}</td>
                          <td><span className="fg-badge">{z.pays?.nom || 'N/A'}</span></td>
                          <td><span className="fg-badge dark">{z.frais_livraison} {z.pays?.devise}</span></td>
                          <td className="text-right">
                            <button onClick={() => supprimerZone(z.id)} className="fg-btn-danger">Supprimer</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* --- ONGLET STATUTS CONFIGURABLES --- */}
          {ongletActif === "statuts" && (
            <div className="fg-card">
              <div className="fg-card-head">
                <h2 className="fg-card-title">Statuts d'appels configurables</h2>
                <p className="fg-card-sub">Gérez les différents états de qualification des appels rattachés à chaque pays.</p>
              </div>

              <form className="fg-form-grid" onSubmit={ajouterStatut}>
                <select 
                  value={nouveauStatut.pays_id}
                  onChange={(e) => setNouveauStatut({...nouveauStatut, pays_id: e.target.value})}
                  className="fg-input"
                >
                  <option value="">Sélectionner un pays</option>
                  {listePays.map((p) => (
                    <option key={p.id} value={p.id}>{p.nom}</option>
                  ))}
                </select>

                <input 
                  type="text" placeholder="Nom du statut (ex: Confirmé)" 
                  value={nouveauStatut.nom}
                  onChange={(e) => setNouveauStatut({...nouveauStatut, nom: e.target.value})}
                  className="fg-input"
                />
                
                <div className="fg-color-wrapper">
                  <label className="text-xs text-gray-500 block mb-1">Couleur</label>
                  <input 
                    type="color" 
                    value={nouveauStatut.couleur}
                    onChange={(e) => setNouveauStatut({...nouveauStatut, couleur: e.target.value})}
                    className="fg-color-input"
                  />
                </div>

                <button type="submit" className="fg-btn-primary">Ajouter</button>
              </form>

              <div className="fg-table-wrap">
                <table className="fg-table">
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
                      <tr><td colSpan="4" className="text-center">Chargement...</td></tr>
                    ) : listeStatuts.length === 0 ? (
                      <tr><td colSpan="4" className="text-center text-gray-400">Aucun statut configuré.</td></tr>
                    ) : (
                      listeStatuts.map((s) => (
                        <tr key={s.id}>
                          <td className="font-medium">{s.nom}</td>
                          <td><span className="fg-badge">{s.pays?.nom || 'N/A'}</span></td>
                          <td>
                            <span 
                              className="fg-badge" 
                              style={{ backgroundColor: s.couleur, color: "#fff" }}
                            >
                              {s.nom}
                            </span>
                          </td>
                          <td className="text-right">
                            <button onClick={() => supprimerStatut(s.id)} className="fg-btn-danger">Supprimer</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* --- ONGLET CATALOGUE PRODUITS --- */}
          {ongletActif === "produits" && (
            <div className="fg-card">
              <div className="fg-card-head">
                <h2 className="fg-card-title">Catalogue Produits</h2>
                <p className="fg-card-sub">Ajoutez et gérez les produits disponibles à la vente dans le CRM.</p>
              </div>

              <form className="fg-form-grid" onSubmit={ajouterProduit}>
                <input 
                  type="text" placeholder="Nom du produit" 
                  value={nouveauProduit.nom}
                  onChange={(e) => setNouveauProduit({...nouveauProduit, nom: e.target.value})}
                  className="fg-input"
                />
                
                <input 
                  type="number" placeholder="Prix" 
                  value={nouveauProduit.prix}
                  onChange={(e) => setNouveauProduit({...nouveauProduit, prix: e.target.value})}
                  className="fg-input"
                />

                <input 
                  type="text" placeholder="Description (optionnel)" 
                  value={nouveauProduit.description}
                  onChange={(e) => setNouveauProduit({...nouveauProduit, description: e.target.value})}
                  className="fg-input"
                />

                <button type="submit" className="fg-btn-primary">Ajouter</button>
              </form>

              <div className="fg-table-wrap">
                <table className="fg-table">
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th>Description</th>
                      <th>Prix</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargement ? (
                      <tr><td colSpan="4" className="text-center">Chargement...</td></tr>
                    ) : listeProduits.length === 0 ? (
                      <tr><td colSpan="4" className="text-center text-gray-400">Aucun produit configuré.</td></tr>
                    ) : (
                      listeProduits.map((pr) => (
                        <tr key={pr.id}>
                          <td className="font-medium">{pr.nom}</td>
                          <td className="text-gray-500 text-sm">{pr.description || '-'}</td>
                          <td><span className="fg-badge dark">{pr.prix}</span></td>
                          <td className="text-right">
                            <button onClick={() => supprimerProduit(pr.id)} className="fg-btn-danger">Supprimer</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

function StyleParametres() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
      .fg-root{--abyssal:#1B2632;--blue:#2C3B4D;--palladian:#EEE9DF;--oatmeal:#C9C1B1;--truffle:#A35139;background:var(--palladian);min-height:100vh;padding:28px;font-family:'Inter',system-ui,sans-serif;color:var(--abyssal);}
      .fg-root *{box-sizing:border-box;}
      .fg-head{margin-bottom:30px;}
      .fg-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--truffle);margin:0 0 6px;}
      .fg-title{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:30px;letter-spacing:-.01em;margin:0;}
      .fg-layout{display:flex;gap:24px;align-items:flex-start;}
      .fg-sidebar{display:flex;flex-direction:column;gap:8px;width:240px;flex-shrink:0;}
      .fg-tab{background:transparent;border:none;text-align:left;padding:12px 16px;border-radius:12px;font-size:14px;font-weight:500;color:#5c5648;cursor:pointer;transition:0.2s;}
      .fg-tab:hover{background:rgba(255,255,255,0.4);}
      .fg-tab.actif{background:#fff;color:var(--abyssal);font-weight:600;box-shadow:0 1px 2px rgba(27,38,50,.04);}
      .fg-content{flex-grow:1;min-width:0;}
      .fg-card{background:#fff;border:1px solid var(--oatmeal);border-radius:16px;padding:24px;box-shadow:0 1px 2px rgba(27,38,50,.04);}
      .fg-card-head{margin-bottom:24px;}
      .fg-card-title{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:19px;margin:0;}
      .fg-card-sub{font-size:13.5px;color:#9a9384;margin:4px 0 0;}
      .fg-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) auto; gap: 12px; align-items: center; margin-bottom: 24px; background: #faf9f7; padding: 16px; border-radius: 12px; border: 1px dashed var(--oatmeal); }
      .fg-input{width:100%;padding:10px 14px;border-radius:8px;border:1px solid var(--oatmeal);font-family:'Inter';font-size:14px;outline:none;background:#fff;}
      .fg-input:focus{border-color:var(--abyssal);}
      .fg-color-wrapper { display: flex; flex-direction: column; }
      .fg-color-input { width: 100%; height: 42px; border: 1px solid var(--oatmeal); border-radius: 8px; cursor: pointer; background: #fff; padding: 2px; }
      .fg-btn-primary{background:var(--abyssal);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:500;cursor:pointer;transition:0.2s;white-space:nowrap;height:42px;}
      .fg-btn-primary:hover{background:var(--blue);}
      .fg-btn-danger{background:transparent;color:var(--truffle);border:1px solid rgba(163,81,57,0.3);padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;}
      .fg-btn-danger:hover{background:rgba(163,81,57,0.1);}
      .fg-table-wrap{border:1px solid var(--oatmeal);border-radius:12px;overflow:hidden;}
      .fg-table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;}
      .fg-table th{background:#faf9f7;padding:12px 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#7a7365;border-bottom:1px solid var(--oatmeal);}
      .fg-table td{padding:14px 16px;border-bottom:1px solid var(--oatmeal);color:var(--abyssal);}
      .fg-table tr:last-child td{border-bottom:none;}
      .text-right{text-align:right;}
      .text-center{text-align:center;}
      .fg-badge{display:inline-block;padding:4px 8px;border-radius:6px;background:var(--palladian);font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:500;}
      .fg-badge.dark{background:var(--blue);color:#fff;}
      .fg-alerte{padding:12px 16px;border-radius:10px;margin-bottom:20px;font-size:14px;font-weight:500;}
      .fg-alerte.succes{background:#d4edda;color:#155724;border:1px solid #c3e6cb;}
      .fg-alerte.erreur{background:#f8d7da;color:#721c24;border:1px solid #f5c6cb;}
    `}</style>
  );
}