"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { supabase } from "../../lib/supabaseClient";

// ==================================================================
//  COMPOSANTS VISUELS
// ==================================================================

function StatCard({ label, valeur, sousLabel, accent }) {
  return (
    <div className="fg-card fg-stat">
      <div className="fg-stat-bar" style={{ background: accent }} />
      <div className="fg-stat-body">
        <span className="fg-stat-label">{label}</span>
        <span className="fg-stat-value">{valeur}</span>
        {sousLabel && <span className="fg-stat-sub">{sousLabel}</span>}
      </div>
    </div>
  );
}

function StatutPill({ children, ton }) {
  const tons = {
    positif: { bg: "#1B26321a", fg: "#1B2632" },
    attente: { bg: "#FFB1622e", fg: "#8a5a1f" },
    negatif: { bg: "#A351391f", fg: "#A35139" },
    neutre:  { bg: "#C9C1B133", fg: "#5c5648" },
  };
  const t = tons[ton] || tons.neutre;
  return (
    <span className="fg-pill" style={{ background: t.bg, color: t.fg }}>
      {children}
    </span>
  );
}

function formatMontant(n, devise) {
  return new Intl.NumberFormat("fr-FR").format(n || 0) + " " + devise;
}

// ==================================================================
//  RÉCUPÉRATION ET CALCUL DES DONNÉES
// ==================================================================

// AJOUT : Prise en compte des dates personnalisées
// AJOUT : Prise en compte des dates personnalisées et tri chronologique
async function chargerStats(periode, dateDebutPerso, dateFinPerso) {
  // 1. Total exact des commandes
  const { count: vraiTotalCommandes } = await supabase
    .from("commandes")
    .select("*", { count: "exact", head: true });

  const maintenant = new Date();
  let dateDebut = new Date(0); 
  let dateFin = new Date();

  if (periode === "Aujourd'hui") {
    dateDebut = new Date();
    dateDebut.setHours(0, 0, 0, 0);
  } else if (periode === "7 jours") {
    dateDebut = new Date();
    dateDebut.setDate(maintenant.getDate() - 7);
  } else if (periode === "30 jours") {
    dateDebut = new Date();
    dateDebut.setDate(maintenant.getDate() - 30);
  } else if (periode === "Personnalisé") {
    if (dateDebutPerso) dateDebut = new Date(dateDebutPerso);
    if (dateFinPerso) {
      dateFin = new Date(dateFinPerso);
      dateFin.setHours(23, 59, 59, 999);
    }
  }

  const todayYMD = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(maintenant.getDate()).padStart(2, '0')}`;
  
  const { count: commandesAujourdhuiExact } = await supabase
    .from("commandes")
    .select("*", { count: "exact", head: true })
    .gte("created_at", `${todayYMD}T00:00:00`);

  // CORRECTION ICI : Ajout de .order('created_at', { ascending: false }) pour garantir d'avoir les nouvelles données
  const [resCmds, resLivs, resPays, resAppels, resAgents] = await Promise.all([
    supabase
      .from("commandes")
      .select("id, statut_confirmation, date_commande, created_at, updated_at, quantite, produit")
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from("livraisons")
      .select("statut, commande_id")
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from("paiements")
      .select("montant")
      .in("statut", ["en_attente", "encaisse", "remis"])
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from("appels")
      .select("agent_id, commande_id, created_at, statut")
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from("agents")
      .select("id, nom")
      .limit(1000)
  ]);

  const cmds = resCmds.data || [];
  const livs = resLivs.data || [];
  const paiements = resPays.data || [];
  const appels = resAppels.data || [];
  const agents = resAgents.data || [];

  const totalCmds = vraiTotalCommandes || cmds.length;
  
  const commandesAujourdhui = commandesAujourdhuiExact !== null ? commandesAujourdhuiExact : cmds.filter((c) => {
    const dateCible = c.created_at || c.date_commande;
    if (!dateCible) return false;
    return String(dateCible).split('T')[0] === todayYMD;
  }).length;

  const cmdsConfirmees = cmds.filter((c) => c.statut_confirmation === "confirmed").length;
  const tauxConfirmation = totalCmds > 0 ? ((cmdsConfirmees / totalCmds) * 100).toFixed(1) : 0;

  const livrees = livs.filter((l) => l.statut === "livre" || l.statut === "livrée"); 
  const tauxLivraison = livs.length > 0 ? ((livrees.length / livs.length) * 100).toFixed(1) : 0;
  const caEncaisse = paiements.reduce((acc, curr) => acc + (Number(curr.montant) || 0), 0);

  const hourly = Array.from({ length: 24 }, (_, h) => ({ heure: h, confirmees: 0, annulees: 0 }));
  cmds.forEach((c) => {
    const dateAction = c.updated_at || c.created_at || c.date_commande;
    if (!dateAction) return;
    const dateCmd = new Date(dateAction);
    if (dateCmd < dateDebut) return; 
    if (periode === "Personnalisé" && dateFinPerso && dateCmd > dateFin) return;

    const hour = dateCmd.getHours();
    if (c.statut_confirmation === "confirmed") {
      hourly[hour].confirmees++;
    } else if (c.statut_confirmation === "cancelled") {
      hourly[hour].annulees++;
    }
  });

  const countLivs = {};
  livs.forEach((l) => {
    let s = (l.statut || "en_attente").toLowerCase().trim().replace(/\s+/g, "_");
    if (s.includes("expedi") || s === "a_expedier") s = "en_attente";
    if (s === "livrée" || s === "livree") s = "livre";
    countLivs[s] = (countLivs[s] || 0) + 1;
  });

  const labelsLivraison = { "en_attente": "En attente", "livre": "Livrée", "injoignable": "Injoignable", "retour": "Retour" };
  const couleursLivraison = { "en_attente": "#FFB162", "livre": "#1B2632", "injoignable": "#C9C1B1", "retour": "#A35139" };
  const statutsLivraison = Object.entries(countLivs).map(([cle, valeur]) => ({
    nom: labelsLivraison[cle] || cle, valeur, couleur: couleursLivraison[cle] || "#C9C1B1" 
  }));

  const appelCounts = {};
  cmds.forEach((c) => {
    const s = c.statut_confirmation || "en_attente";
    appelCounts[s] = (appelCounts[s] || 0) + 1;
  });
  const labelsAppels = { 'en_attente': "En file", 'unreached': "Injoignable", 'reminder': "À rappeler", 'double': "Doublon", 'confirmed': "Confirmée", 'cancelled': "Annulée", 'spam': "Spam", 'not_active_yet': "Attente activation" };
  const overviewAppels = Object.entries(appelCounts)
    .map(([statut, valeur]) => ({
      label: labelsAppels[statut] || statut, valeur,
      pct: cmds.length > 0 ? Math.round((valeur / cmds.length) * 100) : 0
    })).sort((a, b) => b.valeur - a.valeur);

  const prodCounts = {};
  cmds.forEach((c) => {
    if (!c.produit) return;
    prodCounts[c.produit] = (prodCounts[c.produit] || 0) + (Number(c.quantite) || 1);
  });
  const topProduits = Object.entries(prodCounts)
    .map(([nom, qte]) => ({ nom, qte })).sort((a, b) => b.qte - a.qte).slice(0, 5)
    .map((p, i) => ({ rang: i + 1, nom: p.nom, qte: p.qte }));

  // CORRECTION ICI : Éviter les points en double et prendre l'agent le plus récent
  const livreesCmdIds = new Set(livrees.map(l => l.commande_id));
  const agentDeliveredCounts = {};
  const commandesAttribuees = new Set(); // Stocke les commandes pour ne pas les compter 2 fois

  // Grâce au tri chronologique au début, le premier appel croisé est le plus récent
  appels.forEach(appel => {
    if (livreesCmdIds.has(appel.commande_id)) {
      if (!commandesAttribuees.has(appel.commande_id)) {
        agentDeliveredCounts[appel.agent_id] = (agentDeliveredCounts[appel.agent_id] || 0) + 1;
        commandesAttribuees.add(appel.commande_id); // On verrouille cette commande
      }
    }
  });

  const topAgents = Object.entries(agentDeliveredCounts)
    .map(([agentId, count]) => {
      const sansAgent = !agentId || agentId === "null" || agentId === "undefined";
      const agentObj = sansAgent ? null : agents.find(a => String(a.id) === String(agentId));
      return { 
        nom: sansAgent ? "Agent non assigné" : (agentObj?.nom || `Agent #${agentId}`), 
        livrees: count 
      };
    })
    .sort((a, b) => b.livrees - a.livrees)
    .slice(0, 5);

  return {
    pays: "Angola", devise: "AOA",
    kpis: { commandesTotal: totalCmds, commandesJour: commandesAujourdhui, tauxConfirmation: Number(tauxConfirmation), tauxLivraison: Number(tauxLivraison), caEncaisse: caEncaisse },
    confirmationParHeure: hourly, statutsLivraison, overviewAppels, topProduits, topAgents,
  };
}
// ==================================================================
//  PAGE PRINCIPALE
// ==================================================================

export default function DashboardFGMED() {
  const [data, setData] = useState(null);
  
  // AJOUT : États pour la gestion des dates
  const [periode, setPeriode] = useState("Aujourd'hui");
  const [dateDebutPerso, setDateDebutPerso] = useState("");
  const [dateFinPerso, setDateFinPerso] = useState("");
  
  const router = useRouter();
  
  useEffect(() => {
    async function verifierAccesDashboard() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }

      // Récupérer le rôle de l'utilisateur connecté
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle();

      const role = roleData?.role;

      // 🚫 Rediriger l'agent vers son centre d'appel
      if (role === 'agent') {
        router.push('/centre-appel');
        return;
      }

      // 🚫 Rediriger le livreur vers son espace de livraison
      if (role === 'livreur') {
        router.push('/livraisons');
        return;
      }

      // Si ce n'est ni un admin, on sécurise en le renvoyant vers l'accueil
      if (role !== 'admin') {
        router.push('/');
      }
    }
    verifierAccesDashboard();
  }, [router]);

  // AJOUT : Dépendances mises à jour pour relancer la fonction si une date change
  useEffect(() => {
    chargerStats(periode, dateDebutPerso, dateFinPerso).then(setData);
  }, [periode, dateDebutPerso, dateFinPerso]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-[#1B2632] font-medium">
        <StyleFGMED />
        Chargement des statistiques...
      </div>
    );
  }

  const { kpis, pays, devise } = data;
  const totalLivraison = data.statutsLivraison.reduce((s, x) => s + x.valeur, 0);

  return (
    <div className="fg-root">
      <StyleFGMED />

      {/* En-tête */}
      <header className="fg-head">
        <div>
          <p className="fg-eyebrow">Centre logistique</p>
          <h1 className="fg-title">Tableau de bord</h1>
        </div>
        
        {/* AJOUT : Intégration du filtre par date aux côtés des boutons existants */}
        <div className="fg-periode">
          {["Aujourd'hui", "7 jours", "30 jours"].map((p) => (
            <button
              key={p}
              className={"fg-periode-btn" + (periode === p ? " actif" : "")}
              onClick={() => {
                setPeriode(p);
                setDateDebutPerso("");
                setDateFinPerso("");
              }}
            >
              {p}
            </button>
          ))}
          
          <div className="fg-date-wrap">
            <span className="fg-date-label">Du</span>
            <input 
              type="date" 
              value={dateDebutPerso} 
              onChange={(e) => { 
                setDateDebutPerso(e.target.value); 
                setPeriode('Personnalisé'); 
              }} 
              className="fg-date-input" 
            />
            <span className="fg-date-label">Au</span>
            <input 
              type="date" 
              value={dateFinPerso} 
              onChange={(e) => { 
                setDateFinPerso(e.target.value); 
                setPeriode('Personnalisé'); 
              }} 
              className="fg-date-input" 
            />
          </div>
        </div>
      </header>

      {/* Bandeau KPIs */}
      <section className="fg-kpis">
        <StatCard
          label="Total Commandes"
          valeur={kpis.commandesTotal}
          sousLabel="historique global"
          accent="#C9C1B1"
        />
        <StatCard
          label="Aujourd'hui"
          valeur={kpis.commandesJour}
          sousLabel="nouvelles entrées"
          accent="#1B2632"
        />
        <StatCard
          label="Taux Confirmation"
          valeur={kpis.tauxConfirmation + " %"}
          sousLabel="appels aboutis"
          accent="#FFB162"
        />
        <StatCard
          label="Taux Livraison"
          valeur={kpis.tauxLivraison + " %"}
          sousLabel="commandes livrées"
          accent="#2C3B4D"
        />
        <StatCard
          label="Encaissé (COD)"
          valeur={formatMontant(kpis.caEncaisse, devise)}
          sousLabel="remis en caisse"
          accent="#A35139"
        />
      </section>

      {/* Graphiques */}
      <section className="fg-grid-2">
        <div className="fg-card">
          <div className="fg-card-head">
            <div>
              <h2 className="fg-card-title">Confirmation — centre d'appel</h2>
              <p className="fg-card-sub">Répartition horaire</p>
            </div>
            <div className="fg-legend">
              <span><i style={{ background: "#1B2632" }} />Confirmées</span>
              <span><i style={{ background: "#A35139" }} />Annulées</span>
            </div>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.confirmationParHeure} barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#C9C1B155" vertical={false} />
                <XAxis dataKey="heure" tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#5c5648" }} interval={1} />
                <YAxis tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#5c5648" }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontFamily: "Inter", borderRadius: 10, border: "1px solid #C9C1B1", background: "#fff", fontSize: 12 }} labelFormatter={(h) => `${h}h`} />
                <Bar dataKey="confirmees" name="Confirmées" fill="#1B2632" radius={[3, 3, 0, 0]} />
                <Bar dataKey="annulees" name="Annulées" fill="#A35139" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="fg-card">
          <div className="fg-card-head">
            <div>
              <h2 className="fg-card-title">Statuts de livraison</h2>
              <p className="fg-card-sub">{totalLivraison} suivies</p>
            </div>
          </div>
          <div className="fg-donut-wrap">
            <div style={{ width: 180, height: 180 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.statutsLivraison} dataKey="valeur" nameKey="nom" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                    {data.statutsLivraison.map((s, i) => <Cell key={i} fill={s.couleur} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontFamily: "Inter", borderRadius: 10, border: "1px solid #C9C1B1", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="fg-donut-legend">
              {data.statutsLivraison.length === 0 && <li className="text-sm text-gray-400">Aucune livraison</li>}
              {data.statutsLivraison.map((s, i) => (
                <li key={i}>
                  <span className="fg-dot" style={{ background: s.couleur }} />
                  <span className="fg-donut-nom">{s.nom}</span>
                  <span className="fg-donut-val">{s.valeur}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Grille de 3 pour les analyses détaillées */}
      <section className="fg-grid-3">
        
        {/* 1. Appels */}
        <div className="fg-card">
          <div className="fg-card-head">
            <h2 className="fg-card-title">Vue d'ensemble des appels</h2>
          </div>
          <ul className="fg-overview">
            {data.overviewAppels.length === 0 && <li className="text-sm text-gray-400">Aucun appel</li>}
            {data.overviewAppels.map((o, i) => (
              <li key={i}>
                <span className="fg-ov-label">{o.label}</span>
                <div className="fg-ov-track">
                  <div className="fg-ov-fill" style={{ width: o.pct + "%" }} />
                </div>
                <span className="fg-ov-val">{o.valeur}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 2. Produits */}
        <div className="fg-card">
          <div className="fg-card-head">
            <h2 className="fg-card-title">Top Produits</h2>
          </div>
          <ol className="fg-top">
            {data.topProduits.length === 0 && <li className="text-sm text-gray-400">Aucun produit</li>}
            {data.topProduits.map((p) => (
              <li key={p.rang}>
                <span className="fg-rang">{p.rang}</span>
                <span className="fg-top-nom">{p.nom}</span>
                <div className="fg-top-bar">
                  <div className="fg-top-fill" style={{ width: (p.qte / data.topProduits[0].qte) * 100 + "%" }} />
                </div>
                <span className="fg-qte">{p.qte}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* 3. Classement Agents par Livraison */}
        <div className="fg-card">
          <div className="fg-card-head">
            <h2 className="fg-card-title">Top Agents (Livrées)</h2>
            <StatutPill ton="positif">Livrées</StatutPill>
          </div>
          <ol className="fg-top">
            {(!data.topAgents || data.topAgents.length === 0) && (
              <li className="text-sm text-[#1B2632]/50 italic">Aucune commande livrée n'est liée à un agent.</li>
            )}
            {(data.topAgents || []).map((a, i) => (
              <li key={i}>
                <span className="fg-rang">{i + 1}</span>
                <span className="fg-top-nom">{a.nom}</span>
                <div className="fg-top-bar">
                  <div 
                    className="fg-top-fill" 
                    style={{ 
                      width: (a.livrees / (data.topAgents[0]?.livrees || 1)) * 100 + "%", 
                      background: "#FFB162" 
                    }} 
                  />
                </div>
                <span className="fg-qte">{a.livrees}</span>
              </li>
            ))}
          </ol>
        </div>
        
      </section>
    </div>
  );
}

// ==================================================================
//  STYLES
// ==================================================================
function StyleFGMED() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

      .fg-root{
        --abyssal:#1B2632; --blue:#2C3B4D; --palladian:#EEE9DF;
        --oatmeal:#C9C1B1; --flame:#FFB162; --truffle:#A35139;
        background:var(--palladian); min-height:100%; padding:28px;
        font-family:'Inter',system-ui,sans-serif; color:var(--abyssal);
      }
      .fg-root *{box-sizing:border-box;}

      .fg-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:22px;}
      .fg-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--truffle);margin:0 0 6px;}
      .fg-title{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:30px;letter-spacing:-.01em;margin:0;}
      
      /* AJOUT : Mise à jour du conteneur de périodes pour inclure le champ de date en beauté */
      .fg-periode{display:flex;align-items:center;gap:4px;background:#fff;border:1px solid var(--oatmeal);border-radius:12px;padding:4px;}
      .fg-periode-btn{border:none;background:transparent;padding:7px 14px;border-radius:9px;font-family:'Inter';font-size:13px;font-weight:500;color:#5c5648;cursor:pointer;transition:.15s;}
      .fg-periode-btn:hover{color:var(--abyssal);}
      .fg-periode-btn.actif{background:var(--abyssal);color:#fff;}
      
      .fg-date-wrap {display:flex;align-items:center;gap:8px;border-left:1px solid var(--oatmeal);padding-left:10px;margin-left:4px;}
      .fg-date-label {font-size:11px;font-weight:700;color:rgba(27,38,50,0.4);text-transform:uppercase;letter-spacing:0.1em;}
      .fg-date-input {border:none;background:transparent;font-family:'Inter',sans-serif;font-size:13px;color:var(--abyssal);font-weight:500;outline:none;cursor:pointer;}

      .fg-card{background:#fff;border:1px solid var(--oatmeal);border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(27,38,50,.04);}

      /* Grille fluide pour les KPIs (5 éléments) */
      .fg-kpis{display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:16px;margin-bottom:16px;}
      .fg-stat{padding:0;overflow:hidden;display:flex;}
      .fg-stat-bar{width:5px;flex:none;}
      .fg-stat-body{padding:18px 20px;display:flex;flex-direction:column;gap:4px;}
      .fg-stat-label{font-size:12px;font-weight:500;color:#7a7365;text-transform:uppercase;letter-spacing:.04em;}
      .fg-stat-value{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:26px;color:var(--abyssal);line-height:1.1;}
      .fg-stat-sub{font-size:12px;color:#9a9384;}

      .fg-grid-2{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px;}
      
      /* Nouvelle grille 3 colonnes pour le bas */
      .fg-grid-3{display:grid;grid-template-columns:repeat(3, 1fr);gap:16px;}

      .fg-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;}
      .fg-card-title{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:17px;margin:0;}
      .fg-card-sub{font-size:12.5px;color:#9a9384;margin:3px 0 0;}
      .fg-legend{display:flex;gap:14px;font-size:12px;color:#5c5648;}
      .fg-legend span{display:flex;align-items:center;gap:6px;}
      .fg-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;}

      .fg-donut-wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap;justify-content:center;}
      .fg-donut-legend{list-style:none;margin:0;padding:0;flex:1;min-width:130px;display:flex;flex-direction:column;gap:9px;}
      .fg-donut-legend li{display:flex;align-items:center;gap:10px;font-size:13px;}
      .fg-dot{width:11px;height:11px;border-radius:50%;flex:none;}
      .fg-donut-nom{flex:1;color:#4a4437;text-transform:capitalize;}
      .fg-donut-val{font-family:'IBM Plex Mono',monospace;font-weight:500;color:var(--abyssal);}

      .fg-overview{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px;}
      .fg-overview li{display:grid;grid-template-columns:100px 1fr 40px;align-items:center;gap:10px;}
      .fg-ov-label{font-size:13px;color:#4a4437;}
      .fg-ov-track{height:7px;background:var(--palladian);border-radius:6px;overflow:hidden;}
      .fg-ov-fill{height:100%;background:linear-gradient(90deg,var(--flame),var(--truffle));border-radius:6px;}
      .fg-ov-val{font-family:'IBM Plex Mono',monospace;font-size:13px;text-align:right;color:var(--abyssal);}

      .fg-top{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:13px;}
      .fg-top li{display:grid;grid-template-columns:26px 1fr 60px 30px;align-items:center;gap:10px;}
      .fg-rang{width:26px;height:26px;border-radius:8px;background:var(--palladian);display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono';font-weight:500;font-size:13px;}
      .fg-top li:first-child .fg-rang{background:var(--flame);color:var(--abyssal);}
      .fg-top-nom{font-size:13px;color:#3a3529;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .fg-top-bar{height:6px;background:var(--palladian);border-radius:6px;overflow:hidden;}
      .fg-top-fill{height:100%;background:var(--blue);border-radius:6px;}
      .fg-qte{font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:14px;text-align:right;}

      .fg-pill{display:inline-flex;align-items:center;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;font-family:'Inter';}

      @media (max-width:1200px){
        .fg-grid-3{grid-template-columns:repeat(2,1fr);}
      }
      @media (max-width:1000px){
        .fg-grid-2{grid-template-columns:1fr;}
      }
      @media (max-width:800px){
        .fg-grid-3{grid-template-columns:1fr;}
        .fg-root{padding:16px;}
        .fg-periode { flex-wrap: wrap; }
      }
    `}</style>
  );
}