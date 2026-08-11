"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../context/PermissionsContext";

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

// 🚀 UNE SEULE carte "Encaissé" — les devises sont listées proprement
// à l'intérieur au lieu de casser la grille avec plusieurs cartes.
// 🚀 Carte "Encaissé" avec cube 3D rotatif — une devise par face.
// Tourne automatiquement, pause au survol, navigation manuelle possible.
function StatCardEncaisse({ liste }) {
  const [index, setIndex] = useState(0);
  const [pause, setPause] = useState(false);
  const n = liste.length;

  // 🔄 Rotation automatique toutes les 3,5 s (en pause au survol)
  useEffect(() => {
    if (n <= 1 || pause) return;
    const t = setInterval(() => setIndex((i) => i + 1), 3500);
    return () => clearInterval(t);
  }, [n, pause]);

  // ---- 0 ou 1 devise : affichage classique ----
  if (n <= 1) {
    return (
      <div className="fg-card fg-stat">
        <div className="fg-stat-bar" style={{ background: "#A35139" }} />
        <div className="fg-stat-body">
          <span className="fg-stat-label">Encaissé (COD)</span>
          <span className="fg-stat-value">
            {formatMontant(liste[0]?.total || 0, liste[0]?.devise || "")}
          </span>
          <span className="fg-stat-sub">remis en caisse</span>
        </div>
      </div>
    );
  }

  // ---- Plusieurs devises : cube 3D rotatif ----
  const angle = 360 / n;
  const faceH = 38;
  const radius = Math.round(faceH / 2 / Math.tan(Math.PI / n)) + 4;
  const actif = ((index % n) + n) % n;

  return (
    <div
      className="fg-card fg-stat"
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
    >
      <div className="fg-stat-bar" style={{ background: "#A35139" }} />
      <div className="fg-stat-body">
        <div className="fg-ca-head">
          <span className="fg-stat-label">Encaissé (COD)</span>
          <div className="fg-ca-nav">
            <button type="button" onClick={() => setIndex((i) => i - 1)} aria-label="Devise précédente">‹</button>
            <button type="button" onClick={() => setIndex((i) => i + 1)} aria-label="Devise suivante">›</button>
          </div>
        </div>

        <div className="fg-ca-scene" style={{ height: faceH }}>
          <div
            className="fg-ca-cube"
            style={{ transform: `translateZ(${-radius}px) rotateX(${-index * angle}deg)` }}
          >
            {liste.map((c, i) => (
              <div
                key={c.devise}
                className="fg-ca-face"
                style={{ transform: `rotateX(${i * angle}deg) translateZ(${radius}px)` }}
              >
                <span className="fg-ca-montant">{formatMontant(c.total)}</span>
                <span className="fg-ca-devise">{c.devise}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="fg-ca-foot">
          <span className="fg-stat-sub">remis en caisse · {n} devises</span>
          <div className="fg-ca-dots">
            {liste.map((c, i) => (
              <button
                key={c.devise}
                type="button"
                className={"fg-ca-dot" + (i === actif ? " actif" : "")}
                onClick={() => setIndex(i)}
                aria-label={c.devise}
              />
            ))}
          </div>
        </div>
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
  return (
    new Intl.NumberFormat("fr-FR").format(n || 0) + (devise ? " " + devise : "")
  );
}

function initiales(nom) {
  return (nom || "?")
    .split(" ")
    .map((m) => m[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const AVATAR_COLORS = ["#1B2632", "#A35139", "#2C3B4D", "#8a5a1f", "#5c5648"];

// ==================================================================
//  RÉCUPÉRATION ET CALCUL DES DONNÉES
// ==================================================================
async function chargerStats(periode, dateDebutPerso, dateFinPerso, tenantId) {
  if (!tenantId) return null;

  const { count: vraiTotalCommandes } = await supabase
    .from("commandes")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

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

  const todayYMD = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}-${String(maintenant.getDate()).padStart(2, "0")}`;

  const { count: commandesAujourdhuiExact } = await supabase
    .from("commandes")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", `${todayYMD}T00:00:00`);

  const [resCmds, resLivs, resPaiements, resAppels, resAgents] = await Promise.all([
    supabase.from("commandes").select("id, statut_confirmation, date_commande, created_at, updated_at, quantite, produit, pays(devise)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000),
    supabase.from("livraisons").select("statut, commande_id").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000),
    supabase.from("paiements").select("montant, commandes(pays(devise))").eq("tenant_id", tenantId).in("statut", ["en_attente", "encaisse", "remis"]).order("created_at", { ascending: false }).limit(5000),
    supabase.from("appels").select("agent_id, commande_id, created_at, statut").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000),
    supabase.from("agents").select("id, nom").eq("tenant_id", tenantId).limit(1000),
  ]);

  const cmds = resCmds.data || [];
  const livs = resLivs.data || [];
  const paiements = resPaiements.data || [];
  const appels = resAppels.data || [];
  const agents = resAgents.data || [];

  const totalCmds = vraiTotalCommandes || cmds.length;

  const commandesAujourdhui = commandesAujourdhuiExact !== null ? commandesAujourdhuiExact : cmds.filter((c) => {
    const dateCible = c.created_at || c.date_commande;
    if (!dateCible) return false;
    return String(dateCible).split("T")[0] === todayYMD;
  }).length;

  const cmdsConfirmees = cmds.filter((c) => c.statut_confirmation === "confirmed").length;
  const tauxConfirmation = totalCmds > 0 ? ((cmdsConfirmees / totalCmds) * 100).toFixed(1) : 0;

  const livrees = livs.filter((l) => l.statut === "livre" || l.statut === "livrée");
  const tauxLivraison = livs.length > 0 ? ((livrees.length / livs.length) * 100).toFixed(1) : 0;

  // 🚀 Encaissé regroupé PAR DEVISE — jamais de total mélangé
  const caEncaisseParDevise = {};
  paiements.forEach((p) => {
    const devise = p.commandes?.pays?.devise || "N/A";
    caEncaisseParDevise[devise] = (caEncaisseParDevise[devise] || 0) + (Number(p.montant) || 0);
  });
  const caEncaisseListe = Object.entries(caEncaisseParDevise)
    .map(([devise, total]) => ({ devise, total }))
    .sort((a, b) => b.total - a.total);

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

  const labelsLivraison = { en_attente: "En attente", livre: "Livrée", injoignable: "Injoignable", retour: "Retour" };
  const couleursLivraison = { en_attente: "#FFB162", livre: "#1B2632", injoignable: "#C9C1B1", retour: "#A35139" };
  const statutsLivraison = Object.entries(countLivs).map(([cle, valeur]) => ({
    nom: labelsLivraison[cle] || cle,
    valeur,
    couleur: couleursLivraison[cle] || "#C9C1B1",
  }));

  const appelCounts = {};
  cmds.forEach((c) => {
    const s = c.statut_confirmation || "en_attente";
    appelCounts[s] = (appelCounts[s] || 0) + 1;
  });
  const labelsAppels = {
    en_attente: "En file",
    unreached: "Injoignable",
    reminder: "À rappeler",
    double: "Doublon",
    confirmed: "Confirmée",
    cancelled: "Annulée",
    spam: "Spam",
    not_active_yet: "Attente activation",
  };
  const overviewAppels = Object.entries(appelCounts)
    .map(([statut, valeur]) => ({
      label: labelsAppels[statut] || statut,
      valeur,
      pct: cmds.length > 0 ? Math.round((valeur / cmds.length) * 100) : 0,
    }))
    .sort((a, b) => b.valeur - a.valeur);

  const prodCounts = {};
  cmds.forEach((c) => {
    if (!c.produit) return;
    prodCounts[c.produit] = (prodCounts[c.produit] || 0) + (Number(c.quantite) || 1);
  });
  const topProduits = Object.entries(prodCounts)
    .map(([nom, qte]) => ({ nom, qte }))
    .sort((a, b) => b.qte - a.qte)
    .slice(0, 5)
    .map((p, i) => ({ rang: i + 1, nom: p.nom, qte: p.qte }));

  // ---------- Top Agents (commandes livrées) ----------
  const livreesCmdIds = new Set(livrees.map((l) => l.commande_id));
  const agentDeliveredCounts = {};
  const commandesAttribuees = new Set();

  appels.forEach((appel) => {
    if (livreesCmdIds.has(appel.commande_id)) {
      if (!commandesAttribuees.has(appel.commande_id)) {
        agentDeliveredCounts[appel.agent_id] = (agentDeliveredCounts[appel.agent_id] || 0) + 1;
        commandesAttribuees.add(appel.commande_id);
      }
    }
  });

  const topAgents = Object.entries(agentDeliveredCounts)
    .map(([agentId, count]) => {
      const sansAgent = !agentId || agentId === "null" || agentId === "undefined";
      const agentObj = sansAgent ? null : agents.find((a) => String(a.id) === String(agentId));
      return {
        nom: sansAgent ? "Agent non assigné" : (agentObj?.nom || `Agent #${agentId}`),
        livrees: count,
      };
    })
    .sort((a, b) => b.livrees - a.livrees)
    .slice(0, 5);

  // ==================================================================
  //  🚀 ANALYTICS PAR AGENT
  //  appels / confirmées / injoignables / annulées / reprogrammées
  // ==================================================================
  const statutParCommande = {};
  cmds.forEach((c) => {
    statutParCommande[c.id] = c.statut_confirmation || "en_attente";
  });

  const statsAgents = {};

  const getAgentBucket = (agentId) => {
    const key = agentId || "sans_agent";
    if (!statsAgents[key]) {
      statsAgents[key] = {
        appels: 0,
        confirmees: 0,
        injoignables: 0,
        annulees: 0,
        reprogrammees: 0,
        _commandesVues: new Set(), // évite de compter 2x la même commande pour le même agent
      };
    }
    return statsAgents[key];
  };

  appels.forEach((appel) => {
    const bucket = getAgentBucket(appel.agent_id);
    bucket.appels++;

    const cmdId = appel.commande_id;
    if (!cmdId || bucket._commandesVues.has(cmdId)) return;
    bucket._commandesVues.add(cmdId);

    const st = statutParCommande[cmdId];
    if (st === "confirmed") bucket.confirmees++;
    else if (st === "unreached") bucket.injoignables++;
    else if (st === "cancelled") bucket.annulees++;
    else if (st === "reminder") bucket.reprogrammees++;
  });

  const analyticsAgents = Object.entries(statsAgents)
    .map(([agentId, s]) => {
      const sansAgent = agentId === "sans_agent";
      const agentObj = sansAgent ? null : agents.find((a) => String(a.id) === String(agentId));
      const traitees = s.confirmees + s.injoignables + s.annulees + s.reprogrammees;
      return {
        nom: sansAgent ? "Agent non assigné" : (agentObj?.nom || `Agent #${agentId}`),
        appels: s.appels,
        confirmees: s.confirmees,
        injoignables: s.injoignables,
        annulees: s.annulees,
        reprogrammees: s.reprogrammees,
        traitees,
        taux: traitees > 0 ? Math.round((s.confirmees / traitees) * 100) : 0,
      };
    })
    .sort((a, b) => b.confirmees - a.confirmees || b.appels - a.appels);

  const totauxAgents = analyticsAgents.reduce(
    (acc, a) => ({
      appels: acc.appels + a.appels,
      confirmees: acc.confirmees + a.confirmees,
      injoignables: acc.injoignables + a.injoignables,
      annulees: acc.annulees + a.annulees,
      reprogrammees: acc.reprogrammees + a.reprogrammees,
    }),
    { appels: 0, confirmees: 0, injoignables: 0, annulees: 0, reprogrammees: 0 }
  );

  return {
    caEncaisseListe,
    kpis: {
      commandesTotal: totalCmds,
      commandesJour: commandesAujourdhui,
      tauxConfirmation: Number(tauxConfirmation),
      tauxLivraison: Number(tauxLivraison),
    },
    confirmationParHeure: hourly,
    statutsLivraison,
    overviewAppels,
    topProduits,
    topAgents,
    analyticsAgents,
    totauxAgents,
  };
}

// ==================================================================
//  PAGE PRINCIPALE
// ==================================================================

export default function DashboardFGMED() {
  const { user, tenantId, loading: authLoading } = useAuth();
  const { roleNom, loading: permsLoading } = usePermissions();

  const [data, setData] = useState(null);
  const [periode, setPeriode] = useState("Aujourd'hui");
  const [dateDebutPerso, setDateDebutPerso] = useState("");
  const [dateFinPerso, setDateFinPerso] = useState("");

  const router = useRouter();

  const tenantKey = typeof tenantId === "object" ? tenantId?.id : tenantId;

  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.push("/");
      } else if (roleNom === "super_admin" || roleNom === "SUPER_ADMIN") {
        router.replace("/super-admin/tenants");
      }
    }
  }, [user, authLoading, permsLoading, roleNom, router]);

  useEffect(() => {
    if (authLoading || permsLoading || !tenantKey) return;
    chargerStats(periode, dateDebutPerso, dateFinPerso, tenantKey).then(setData);
  }, [periode, dateDebutPerso, dateFinPerso, tenantKey, authLoading, permsLoading]);

  if (authLoading || permsLoading || (!data && roleNom !== "super_admin" && roleNom !== "SUPER_ADMIN")) {
    return (
      <div className="flex items-center justify-center h-full text-[#1B2632] font-medium p-20">
        <StyleFGMED />
        Chargement des statistiques...
      </div>
    );
  }

  if (roleNom === "super_admin" || roleNom === "SUPER_ADMIN") {
    return null;
  }

  const { kpis, caEncaisseListe, analyticsAgents, totauxAgents } = data;
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
                setPeriode("Personnalisé");
              }}
              className="fg-date-input"
            />
            <span className="fg-date-label">Au</span>
            <input
              type="date"
              value={dateFinPerso}
              onChange={(e) => {
                setDateFinPerso(e.target.value);
                setPeriode("Personnalisé");
              }}
              className="fg-date-input"
            />
          </div>
        </div>
      </header>

      {/* Bandeau KPIs — toujours 5 cartes, quelle que soit le nombre de devises */}
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
        {/* 🚀 Une seule carte Encaissé, les devises listées dedans */}
        <StatCardEncaisse liste={caEncaisseListe} />
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

      {/* 🚀 ANALYTICS PAR AGENT — pleine largeur */}
      <section className="fg-card fg-agents-card">
        <div className="fg-card-head">
          <div>
            <h2 className="fg-card-title">Analytics par agent</h2>
            <p className="fg-card-sub">Performance du centre d'appel — {analyticsAgents.length} agent{analyticsAgents.length > 1 ? "s" : ""}</p>
          </div>
          <StatutPill ton="neutre">Appels · Confirmées · Injoignables · Annulées · Reprogrammées</StatutPill>
        </div>

        {analyticsAgents.length === 0 ? (
          <p className="text-sm text-[#1B2632]/50 italic" style={{ margin: 0 }}>
            Aucun appel enregistré pour le moment.
          </p>
        ) : (
          <div className="fg-table-wrap">
            <table className="fg-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="fg-num-col">Appels</th>
                  <th className="fg-num-col">Confirmées</th>
                  <th className="fg-num-col">Injoignables</th>
                  <th className="fg-num-col">Annulées</th>
                  <th className="fg-num-col">Reprogrammées</th>
                  <th className="fg-taux-col">Taux conf.</th>
                </tr>
              </thead>
              <tbody>
                {analyticsAgents.map((a, i) => (
                  <tr key={a.nom + i}>
                    <td>
                      <div className="fg-agent">
                        <span
                          className="fg-avatar"
                          style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                        >
                          {initiales(a.nom)}
                        </span>
                        <span className="fg-agent-nom">{a.nom}</span>
                      </div>
                    </td>
                    <td className="fg-num-col">
                      <span className="fg-num">{a.appels}</span>
                    </td>
                    <td className="fg-num-col">
                      <span className="fg-num fg-num-ok">{a.confirmees}</span>
                    </td>
                    <td className="fg-num-col">
                      <span className="fg-num fg-num-warn">{a.injoignables}</span>
                    </td>
                    <td className="fg-num-col">
                      <span className="fg-num fg-num-bad">{a.annulees}</span>
                    </td>
                    <td className="fg-num-col">
                      <span className="fg-num fg-num-info">{a.reprogrammees}</span>
                    </td>
                    <td className="fg-taux-col">
                      <div className="fg-taux">
                        <div className="fg-taux-track">
                          <div className="fg-taux-fill" style={{ width: a.taux + "%" }} />
                        </div>
                        <span className="fg-taux-val">{a.taux}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
                            <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="fg-num-col"><span className="fg-num">{totauxAgents.appels}</span></td>
                  <td className="fg-num-col"><span className="fg-num fg-num-ok">{totauxAgents.confirmees}</span></td>
                  <td className="fg-num-col"><span className="fg-num fg-num-warn">{totauxAgents.injoignables}</span></td>
                  <td className="fg-num-col"><span className="fg-num fg-num-bad">{totauxAgents.annulees}</span></td>
                  <td className="fg-num-col"><span className="fg-num fg-num-info">{totauxAgents.reprogrammees}</span></td>
                  <td className="fg-taux-col">
                    {(() => {
                      const traitees =
                        totauxAgents.confirmees +
                        totauxAgents.injoignables +
                        totauxAgents.annulees +
                        totauxAgents.reprogrammees;
                      const taux = traitees > 0 ? Math.round((totauxAgents.confirmees / traitees) * 100) : 0;
                      return (
                        <div className="fg-taux">
                          <div className="fg-taux-track">
                            <div className="fg-taux-fill" style={{ width: taux + "%" }} />
                          </div>
                          <span className="fg-taux-val">{taux}%</span>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
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
                      background: "#FFB162",
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

      /* ============ BASE ============ */
      .fg-root{
        --abyssal:#1B2632; --blue:#2C3B4D; --palladian:#EEE9DF;
        --oatmeal:#C9C1B1; --flame:#FFB162; --truffle:#A35139;
        background:var(--palladian); min-height:100%; padding:28px;
        font-family:'Inter',system-ui,sans-serif; color:var(--abyssal);
      }
      .fg-root *{box-sizing:border-box;}

      /* ============ EN-TÊTE ============ */
      .fg-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:22px;}
      .fg-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--truffle);margin:0 0 6px;}
      .fg-title{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:30px;letter-spacing:-.01em;margin:0;}

      .fg-periode{display:flex;align-items:center;gap:4px;background:#fff;border:1px solid var(--oatmeal);border-radius:12px;padding:4px;}
      .fg-periode-btn{border:none;background:transparent;padding:7px 14px;border-radius:9px;font-family:'Inter';font-size:13px;font-weight:500;color:#5c5648;cursor:pointer;transition:.15s;}
      .fg-periode-btn:hover{color:var(--abyssal);}
      .fg-periode-btn.actif{background:var(--abyssal);color:#fff;}

      .fg-date-wrap{display:flex;align-items:center;gap:8px;border-left:1px solid var(--oatmeal);padding-left:10px;margin-left:4px;}
      .fg-date-label{font-size:11px;font-weight:700;color:rgba(27,38,50,0.4);text-transform:uppercase;letter-spacing:0.1em;}
      .fg-date-input{border:none;background:transparent;font-family:'Inter',sans-serif;font-size:13px;color:var(--abyssal);font-weight:500;outline:none;cursor:pointer;}

      /* ============ CARTES & GRILLES (⚠️ c'était manquant) ============ */
      .fg-card{background:#fff;border:1px solid var(--oatmeal);border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(27,38,50,.04);}
      .fg-grid-2{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px;}
      .fg-grid-3{display:grid;grid-template-columns:repeat(3, 1fr);gap:16px;}

      .fg-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;}
      .fg-card-title{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:17px;margin:0;}
      .fg-card-sub{font-size:12.5px;color:#9a9384;margin:3px 0 0;}

      /* ============ KPIs ============ */
      .fg-kpis{display:grid;grid-template-columns:repeat(auto-fit, minmax(190px, 1fr));gap:16px;margin-bottom:16px;}
      .fg-stat{padding:0;overflow:hidden;display:flex;}
      .fg-stat-bar{width:5px;flex:none;}
      .fg-stat-body{padding:18px 20px;display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;}
      .fg-stat-label{font-size:12px;font-weight:500;color:#7a7365;text-transform:uppercase;letter-spacing:.04em;}
      .fg-stat-value{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:26px;color:var(--abyssal);line-height:1.1;}
      .fg-stat-sub{font-size:12px;color:#9a9384;}

      /* ============ CUBE 3D ENCAISSÉ ============ */
      .fg-ca-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
      .fg-ca-nav{display:flex;gap:4px;}
      .fg-ca-nav button{
        width:20px;height:20px;border-radius:6px;border:1px solid var(--oatmeal);
        background:#fff;color:#7a7365;font-size:13px;line-height:1;cursor:pointer;
        display:flex;align-items:center;justify-content:center;padding:0;transition:.15s;
      }
      .fg-ca-nav button:hover{background:var(--abyssal);border-color:var(--abyssal);color:#fff;}
      .fg-ca-scene{perspective:700px;margin:2px 0;}
      .fg-ca-cube{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .65s cubic-bezier(.34,.1,.2,1);}
      .fg-ca-face{
        position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;gap:10px;
        backface-visibility:hidden;-webkit-backface-visibility:hidden;background:#fff;
      }
      .fg-ca-montant{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:20px;color:var(--abyssal);line-height:1.1;}
      .fg-ca-devise{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:500;letter-spacing:.08em;color:var(--truffle);background:#A3513914;border:1px solid #A3513926;padding:2px 7px;border-radius:20px;flex:none;}
      .fg-ca-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;}
      .fg-ca-dots{display:flex;gap:5px;}
      .fg-ca-dot{width:6px;height:6px;border-radius:50%;border:none;background:var(--oatmeal);padding:0;cursor:pointer;transition:.2s;}
      .fg-ca-dot.actif{background:var(--truffle);transform:scale(1.25);}

      /* ============ LÉGENDE GRAPHIQUE (⚠️ manquait) ============ */
      .fg-legend{display:flex;gap:14px;font-size:12px;color:#5c5648;}
      .fg-legend span{display:flex;align-items:center;gap:6px;}
      .fg-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;}

      /* ============ DONUT (⚠️ manquait) ============ */
      .fg-donut-wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap;justify-content:center;}
      .fg-donut-legend{list-style:none;margin:0;padding:0;flex:1;min-width:130px;display:flex;flex-direction:column;gap:9px;}
      .fg-donut-legend li{display:flex;align-items:center;gap:10px;font-size:13px;}
      .fg-dot{width:11px;height:11px;border-radius:50%;flex:none;}
      .fg-donut-nom{flex:1;color:#4a4437;text-transform:capitalize;}
      .fg-donut-val{font-family:'IBM Plex Mono',monospace;font-weight:500;color:var(--abyssal);}

      /* ============ VUE D'ENSEMBLE APPELS (⚠️ manquait) ============ */
      .fg-overview{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px;}
      .fg-overview li{display:grid;grid-template-columns:100px 1fr 40px;align-items:center;gap:10px;}
      .fg-ov-label{font-size:13px;color:#4a4437;}
      .fg-ov-track{height:7px;background:var(--palladian);border-radius:6px;overflow:hidden;}
      .fg-ov-fill{height:100%;background:linear-gradient(90deg,var(--flame),var(--truffle));border-radius:6px;}
      .fg-ov-val{font-family:'IBM Plex Mono',monospace;font-size:13px;text-align:right;color:var(--abyssal);}

      /* ============ TOP LISTES (⚠️ manquait) ============ */
      .fg-top{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:13px;}
      .fg-top li{display:grid;grid-template-columns:26px 1fr 60px 30px;align-items:center;gap:10px;}
      .fg-rang{width:26px;height:26px;border-radius:8px;background:var(--palladian);display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono';font-weight:500;font-size:13px;}
      .fg-top li:first-child .fg-rang{background:var(--flame);color:var(--abyssal);}
      .fg-top-nom{font-size:13px;color:#3a3529;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .fg-top-bar{height:6px;background:var(--palladian);border-radius:6px;overflow:hidden;}
      .fg-top-fill{height:100%;background:var(--blue);border-radius:6px;}
      .fg-qte{font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:14px;text-align:right;}

      /* ============ PILL (⚠️ manquait) ============ */
      .fg-pill{display:inline-flex;align-items:center;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;font-family:'Inter';white-space:nowrap;}

      /* ============ TABLEAU ANALYTICS AGENTS ============ */
      .fg-agents-card{margin-bottom:16px;}
      .fg-table-wrap{overflow-x:auto;margin:0 -4px;padding:0 4px;}
      .fg-table{width:100%;border-collapse:collapse;min-width:720px;}
      .fg-table th{
        font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:500;
        letter-spacing:.09em;text-transform:uppercase;color:#9a9384;
        text-align:left;padding:10px 12px;border-bottom:1px solid var(--oatmeal);
        white-space:nowrap;
      }
      .fg-table td{padding:11px 12px;border-bottom:1px solid #EEE9DF;vertical-align:middle;font-size:13px;}
      .fg-table tbody tr{transition:background .12s;}
      .fg-table tbody tr:hover{background:#faf8f3;}
      .fg-table tbody tr:last-child td{border-bottom:none;}
      .fg-table tfoot td{
        border-top:2px solid var(--oatmeal);border-bottom:none;
        font-weight:600;color:var(--abyssal);padding-top:12px;font-size:13px;
      }
      .fg-num-col{text-align:right !important;width:1%;white-space:nowrap;}
      .fg-taux-col{width:170px;min-width:150px;}
      .fg-num{font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:13.5px;color:var(--abyssal);}
      .fg-num-ok{color:var(--abyssal);background:#1B263212;padding:3px 9px;border-radius:7px;font-weight:600;}
      .fg-num-warn{color:#8a5a1f;background:#FFB16226;padding:3px 9px;border-radius:7px;}
      .fg-num-bad{color:var(--truffle);background:#A3513918;padding:3px 9px;border-radius:7px;}
      .fg-num-info{color:var(--blue);background:#2C3B4D14;padding:3px 9px;border-radius:7px;}
      .fg-agent{display:flex;align-items:center;gap:10px;min-width:0;}
      .fg-avatar{
        width:30px;height:30px;border-radius:9px;flex:none;
        display:flex;align-items:center;justify-content:center;
        color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:11.5px;letter-spacing:.02em;
      }
      .fg-agent-nom{font-weight:500;color:#3a3529;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .fg-taux{display:flex;align-items:center;gap:10px;}
      .fg-taux-track{flex:1;height:6px;background:var(--palladian);border-radius:6px;overflow:hidden;}
      .fg-taux-fill{height:100%;background:linear-gradient(90deg,var(--flame),var(--truffle));border-radius:6px;transition:width .4s ease;}
      .fg-taux-val{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:500;color:var(--abyssal);min-width:36px;text-align:right;}

      /* ============ RESPONSIVE ============ */
      @media (max-width:1200px){
        .fg-grid-3{grid-template-columns:repeat(2,1fr);}
      }
      @media (max-width:1000px){
        .fg-grid-2{grid-template-columns:1fr;}
      }
      @media (max-width:800px){
        .fg-grid-3{grid-template-columns:1fr;}
        .fg-root{padding:16px;}
        .fg-periode{flex-wrap:wrap;}
        .fg-taux-col{width:120px;min-width:110px;}
      }
    `}</style>
  );
}