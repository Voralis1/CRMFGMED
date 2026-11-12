'use client'

// Le journal des commandes supprimées (12/11, commandes_suppression.sql) :
// qui, quand, pourquoi, et ce qu'était la commande. Lecture seule — la base
// ne laisse lire que qui a « supprimer_commandes » (et le super admin).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { libelleStatut } from '../../lib/libellesStatuts.mjs'

const TAILLE = 50
const LIVRAISON = { a_preparer: 'À préparer', expedie: 'Expédiée', livre: 'Livrée', retour: 'Retour', annule: 'Annulée' }

export default function CommandesSupprimees({ tenantKey, nomDuVendeur, onFermer }) {
  const [lignes, setLignes] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [saisie, setSaisie] = useState('')
  const [texte, setTexte] = useState('')
  const [erreur, setErreur] = useState('')

  const charger = useCallback(async () => {
    if (!tenantKey) return
    setLignes(null); setErreur('')
    let req = supabase
      .from('commandes_supprimees')
      .select('id, supprime_le, supprime_par_nom, lead_id, tracking_number, client_nom, client_telephone, produit, quantite, vendeur_id, statut, statut_livraison, stock_rendu, raison', { count: 'exact' })
      .eq('tenant_id', tenantKey)
      .order('supprime_le', { ascending: false })
      .range(page * TAILLE, page * TAILLE + TAILLE - 1)
    // Les caractères qui cassent le filtre « or » de PostgREST sont retirés.
    const t = texte.replace(/[,()%*\\]/g, ' ').trim()
    if (t) req = req.or(`lead_id.ilike.%${t}%,client_telephone.ilike.%${t}%,client_nom.ilike.%${t}%,tracking_number.ilike.%${t}%`)
    const { data, error, count } = await req
    if (error) { setErreur(error.message); setLignes([]); return }
    setLignes(data || []); setTotal(count || 0)
  }, [tenantKey, page, texte])

  useEffect(() => { charger() }, [charger])

  const nbPages = Math.max(1, Math.ceil(total / TAILLE))
  const date = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

  return (
    <>
      <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={onFermer} />
      <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
        <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[1300px] my-8">
          <div className="flex flex-wrap items-center gap-3 px-6 sm:px-8 pt-7 pb-4">
            <button onClick={onFermer} title="Retour"
              className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <h2 className="text-2xl font-bold text-[#A35139]">Commandes supprimées</h2>
            <span className="text-sm text-[#1B2632]/50">{total} au total</span>
          </div>

          <form className="px-6 sm:px-8 pb-4 flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => { e.preventDefault(); setPage(0); setTexte(saisie) }}>
            <input type="text" value={saisie} onChange={(e) => setSaisie(e.target.value)}
              placeholder="Lead ID, n° de suivi, téléphone ou nom du client"
              className="flex-1 px-3 py-2 border border-[#C9C1B1] rounded-lg bg-white outline-none focus:border-[#FFB162] text-sm" />
            <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold bg-[#1B2632] text-white">Chercher</button>
            {texte && (
              <button type="button" onClick={() => { setSaisie(''); setTexte(''); setPage(0) }}
                className="text-xs font-semibold text-[#A35139] hover:underline">Effacer</button>
            )}
          </form>

          {erreur && (
            <p className="mx-6 sm:mx-8 mb-4 text-sm text-[#A35139]">
              Lecture impossible : {erreur}
            </p>
          )}

          <div className="overflow-auto max-h-[65vh] border-t border-[#C9C1B1]">
            <table className="w-full min-w-[1100px] text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#C9D3DD] text-[11px] uppercase tracking-wider text-[#1B2632]/70 font-bold">
                  <th className="px-4 py-3">Supprimée le</th>
                  <th className="px-4 py-3">Par</th>
                  <th className="px-4 py-3">Lead ID</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Produit</th>
                  <th className="px-4 py-3">Vendeur</th>
                  <th className="px-4 py-3">Statut à la suppression</th>
                  <th className="px-4 py-3">Stock rendu</th>
                  <th className="px-4 py-3">Raison</th>
                </tr>
              </thead>
              <tbody>
                {lignes === null ? (
                  <tr><td colSpan={9} className="text-center py-10 text-[#1B2632]/50">Chargement…</td></tr>
                ) : lignes.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-10 text-[#1B2632]/50">
                    {erreur ? '—' : texte ? 'Aucune commande supprimée pour cette recherche.' : 'Aucune commande supprimée.'}
                  </td></tr>
                ) : lignes.map((l) => (
                  <tr key={l.id} className="border-b border-[#C9C1B1]/50 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">{date(l.supprime_le)}</td>
                    <td className="px-4 py-3">{l.supprime_par_nom || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold">{l.lead_id || '—'}</div>
                      {l.tracking_number && <div className="font-mono text-[#1B2632]/50">{l.tracking_number}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.client_nom || '—'}</div>
                      <div className="text-[#1B2632]/60">{l.client_telephone}</div>
                    </td>
                    <td className="px-4 py-3">{l.produit || '—'}{l.quantite > 1 ? ` × ${l.quantite}` : ''}</td>
                    <td className="px-4 py-3">{nomDuVendeur?.(l.vendeur_id) || '—'}</td>
                    <td className="px-4 py-3">
                      <div>{l.statut ? libelleStatut(l.statut) : '—'}</div>
                      {l.statut_livraison && <div className="text-[#1B2632]/50">Livraison : {LIVRAISON[l.statut_livraison] || l.statut_livraison}</div>}
                    </td>
                    <td className="px-4 py-3">{l.stock_rendu > 0 ? `+${l.stock_rendu}` : '—'}</td>
                    <td className="px-4 py-3 max-w-[280px] whitespace-pre-wrap">{l.raison}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {nbPages > 1 && (
            <div className="flex items-center justify-end gap-3 px-6 sm:px-8 py-4 text-sm">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}
                className="px-3 py-1.5 rounded-lg border border-[#C9C1B1] disabled:opacity-40">Précédent</button>
              <span>Page {page + 1} / {nbPages}</span>
              <button disabled={page + 1 >= nbPages} onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 rounded-lg border border-[#C9C1B1] disabled:opacity-40">Suivant</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
