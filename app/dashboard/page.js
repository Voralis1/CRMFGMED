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

function StatCardEncaisse({ liste }) {
  const [index, setIndex] = useState(0);
  const [pause, setPause] = useState(false);
  const n = liste.length;

  useEffect(() => {
    if (n <= 1 || pause) return;
    const t = setInterval(() => setIndex((i) => i + 1), 3500);
    return () => clearInterval(t);
  }, [n, pause]);

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
// La base fait tout le calcul (voir supabase/sql/stats_dashboard.sql) : la page
// ne télécharge plus des milliers de lignes pour les compter dans le navigateur.
// La fonction tourne avec les droits de l'appelant, donc un seller n'obtient que
// les chiffres de SES leads — c'est la base qui tranche, pas l'écran.
async function chargerStats(periode, dateDebutPerso, dateFinPerso, tenantId) {
  if (!tenantId) return null;

  const maintenant = new Date();
  let debut = new Date(0);
  let fin = new Date();

  if (periode === "Aujourd'hui") {
    debut = new Date();
    debut.setHours(0, 0, 0, 0);
  } else if (periode === "7 jours") {
    debut = new Date();
    debut.setDate(maintenant.getDate() - 7);
  } else if (periode === "30 jours") {
    debut = new Date();
    debut.setDate(maintenant.getDate() - 30);
  } else if (periode === "Personnalisé") {
    if (dateDebutPerso) debut = new Date(dateDebutPerso);
    if (dateFinPerso) {
      fin = new Date(dateFinPerso);
      fin.setHours(23, 59, 59, 999);
    }
  }

  const { data, error } = await supabase.rpc("stats_dashboard", {
    p_tenant: tenantId,
    p_debut: debut.toISOString(),
    p_fin: fin.toISOString(),
  });

  if (error) {
    console.error("stats_dashboard:", error.message);
    return null;
  }
  return data;
}

// ==================================================================
//  PAGE PRINCIPALE
// ==================================================================

export default function DashboardFGMED() {
  const { user, tenantId, loading: authLoading } = useAuth();
  // 🚀 On récupère 'hasPermission' en plus de 'roleNom'
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions();

  const [data, setData] = useState(null);
  const [periode, setPeriode] = useState("Aujourd'hui");
  const [dateDebutPerso, setDateDebutPerso] = useState("");
  const [dateFinPerso, setDateFinPerso] = useState("");

  const router = useRouter();

  const tenantKey = typeof tenantId === "object" ? tenantId?.id : tenantId;
  // Un seller ne voit que ses propres chiffres : la base les lui sert déjà
  // filtrés, et les tableaux qui parlent des agents n'ont rien à faire chez lui.
  const estSeller = String(roleNom || "").toLowerCase() === "seller";

  // 🚀 REDIRECTION SÉCURISÉE (RBAC STRICT)
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      // 1. L'utilisateur n'est pas connecté
      if (!user) {
        router.replace("/");
      } 
      // 2. L'utilisateur est connecté mais n'a PAS la permission de voir le dashboard 
      //    (et n'est pas super_admin)
      else if (!hasPermission("menu_dashboard") && roleNom !== "super_admin" && roleNom !== "SUPER_ADMIN") {
        // On le redirige vers sa page légitime selon son rôle
        if (roleNom === "livreur" || roleNom === "LIVREUR") {
          router.replace("/livraisons");
        } else if (roleNom === "agent" || roleNom === "AGENT") {
          router.replace("/centre-appel");
        } else {
          router.replace("/"); // Protection par défaut
        }
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, roleNom, router]);
  
  // Chargement des stats
  useEffect(() => {
    if (authLoading || permsLoading) return;
    // On charge les données seulement si l'utilisateur y est autorisé
    if (hasPermission("menu_dashboard") || roleNom === "super_admin" || roleNom === "SUPER_ADMIN") {
      chargerStats(periode, dateDebutPerso, dateFinPerso, tenantKey).then(setData);
    }
  }, [periode, dateDebutPerso, dateFinPerso, tenantKey, authLoading, permsLoading, hasPermission, roleNom]);

  if (authLoading || permsLoading || !data) {
    return (
      <div className="flex items-center justify-center h-full text-[#1B2632] font-medium p-20">
        <StyleFGMED />
        Chargement des statistiques...
      </div>
    );
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
            <div className="w-[180px] max-w-full h-[180px] shrink-0">
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

      {/* Analytics par agent — un seller ne voit jamais le travail des agents */}
      {!estSeller && (<>
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
      </section></>)}

      {/* Grille de 3 pour les analyses détaillées */}
      <section className="fg-grid-3">
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

        {!estSeller && (<div className="fg-card">
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
        </div>)}
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
        background:var(--palladian); min-height:100%; padding:16px;
        font-family:'Inter',system-ui,sans-serif; color:var(--abyssal);
      }
      .fg-root *{box-sizing:border-box;}

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

      .fg-card{background:#fff;border:1px solid var(--oatmeal);border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(27,38,50,.04);}
      .fg-grid-2{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px;}
      .fg-grid-3{display:grid;grid-template-columns:repeat(3, 1fr);gap:16px;}

      .fg-card-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;}
      .fg-card-head>*{min-width:0;max-width:100%;}
      .fg-card-title{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:17px;margin:0;}
      .fg-card-sub{font-size:12.5px;color:#9a9384;margin:3px 0 0;}

      .fg-kpis{display:grid;grid-template-columns:repeat(auto-fit, minmax(190px, 1fr));gap:16px;margin-bottom:16px;}
      .fg-stat{padding:0;overflow:hidden;display:flex;}
      .fg-stat-bar{width:5px;flex:none;}
      .fg-stat-body{padding:18px 20px;display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;}
      .fg-stat-label{font-size:12px;font-weight:500;color:#7a7365;text-transform:uppercase;letter-spacing:.04em;}
      .fg-stat-value{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:26px;color:var(--abyssal);line-height:1.1;}
      .fg-stat-sub{font-size:12px;color:#9a9384;}

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

      .fg-pill{display:inline-flex;align-items:center;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;font-family:'Inter';white-space:normal;max-width:100%;}

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

      @media (max-width:1200px){
        .fg-grid-3{grid-template-columns:repeat(2,1fr);}
      }
      @media (max-width:1000px){
        .fg-grid-2{grid-template-columns:1fr;}
      }
      @media (max-width:800px){
        .fg-grid-3{grid-template-columns:1fr;}
        .fg-root{padding:14px;}
        .fg-periode{flex-wrap:wrap;}
        .fg-taux-col{width:120px;min-width:110px;}
      }
      @media (max-width:680px){
        /* Les champs date natifs ne descendent jamais sous ~130px : côte à côte,
           "Du __ Au __" ne tient pas sur un téléphone. On les empile. */
        .fg-periode{width:100%;flex-wrap:wrap;}
        .fg-periode-btn{flex:1 1 auto;text-align:center;}
        .fg-date-wrap{
          width:100%;border-left:none;padding-left:0;margin-left:0;
          display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;
          padding-top:8px;border-top:1px solid var(--oatmeal);
        }
        .fg-date-input{width:100%;min-width:0;}
      }
      @media (max-width:600px){
        .fg-root{padding:12px;}
        .fg-title{font-size:24px;}
        .fg-card{padding:16px;}
        .fg-stat-body{padding:16px;}
        .fg-stat-value{font-size:23px;}
        .fg-card-head{flex-wrap:wrap;}
        .fg-pill{white-space:normal;}
        .fg-periode{width:100%;}
        .fg-legend{gap:10px;font-size:11px;flex-wrap:wrap;}
        .fg-overview li{grid-template-columns:86px 1fr 32px;gap:8px;}
        .fg-top li{grid-template-columns:24px 1fr 44px 28px;gap:8px;}
      }
    `}</style>
  );
}