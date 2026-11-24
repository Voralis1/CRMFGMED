'use client'

// Le compte rendu d'une affectation par lot (29/10) : affecter_agent_lot /
// affecter_livreur_lot rendent une ligne par commande — appliqué, inchangé ou
// refusé + la raison. Ce bandeau NOMME chaque refus (n° de lead, client,
// raison) : personne ne doit chercher dans la liste lesquelles n'ont pas
// bougé. Il reste affiché jusqu'à ce qu'on le ferme, même si la liste se
// recharge et que les lignes changent de page.
//
// resultat : { action, appliques, inchanges, refus: [{ id, lead, client, motif }] }
// ou { action, erreur } quand l'appel entier a échoué (rien n'a été appliqué).
// Refait le 24/11 (sa remarque : « pas joli ») : avant, « 0 appliqué » disait
// quand même « Les autres sont faits », tout était rouge et la même raison
// se répétait sur chaque ligne. Maintenant : une couleur selon l'issue (tout
// fait / en partie / rien), une phrase juste, et les refus RANGÉS PAR RAISON —
// la raison une fois, puis les commandes qu'elle concerne.
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`

function Fermer({ onFermer }) {
  return (
    <button onClick={onFermer} aria-label="Fermer" title="Fermer"
      className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[#1B2632]/40 hover:text-[#1B2632] hover:bg-[#1B2632]/5 cursor-pointer">
      ✕
    </button>
  )
}

export default function ResultatLot({ resultat, onFermer }) {
  if (!resultat) return null

  if (resultat.erreur) {
    return (
      <div role="alert" className="rounded-2xl border border-[#A35139]/40 bg-[#F8ECE8] px-4 py-3 text-sm text-[#1B2632] flex items-start gap-3">
        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-[#A35139] text-white text-xs font-bold flex items-center justify-center">!</span>
        <div className="flex-1">
          <p className="font-bold">{resultat.action} : rien n&apos;a été appliqué.</p>
          <p className="text-[#1B2632]/75 mt-0.5">{resultat.erreur}</p>
        </div>
        <Fermer onFermer={onFermer} />
      </div>
    )
  }

  const { appliques, inchanges, refus } = resultat
  const faits = appliques + inchanges
  const issue = refus.length === 0 ? 'ok' : faits === 0 ? 'rien' : 'partiel'
  const style = {
    ok: { bord: '#2E7D53', fond: '#EAF4EE', icone: '✓' },
    partiel: { bord: '#C9822F', fond: '#FBF1E4', icone: '!' },
    rien: { bord: '#A35139', fond: '#F8ECE8', icone: '!' },
  }[issue]

  // Les refus rangés par raison, dans l'ordre où ils arrivent.
  const parMotif = new Map()
  for (const r of refus) {
    const m = r.motif || 'Refusé.'
    if (!parMotif.has(m)) parMotif.set(m, [])
    parMotif.get(m).push(r)
  }

  return (
    <div role={issue === 'ok' ? 'status' : 'alert'} className="rounded-2xl border px-4 py-3 text-sm text-[#1B2632]"
      style={{ background: style.fond, borderColor: `${style.bord}66` }}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ background: style.bord }}>{style.icone}</span>
        <div className="flex-1 min-w-0">
          <p className="font-bold">
            {issue === 'rien'
              ? `${resultat.action} : aucune commande traitée, ${refus.length} refusée${refus.length > 1 ? 's' : ''}`
              : <>{resultat.action} : {pluriel(appliques, 'commande')} traitée{appliques > 1 ? 's' : ''}
                  {inchanges > 0 && <span className="font-semibold text-[#1B2632]/60"> · {inchanges} déjà ainsi</span>}
                  {refus.length > 0 && <span style={{ color: style.bord }}> · {refus.length} refusée{refus.length > 1 ? 's' : ''}</span>}</>}
          </p>
          {refus.length > 0 && (
            <p className="text-xs text-[#1B2632]/60 mt-0.5">
              {refus.length === 1
                ? `${issue === 'rien' ? 'Elle n’a pas été modifiée' : 'La refusée n’a pas bougé'} ; elle reste cochée.`
                : `${issue === 'rien' ? 'Aucune n’a été modifiée' : 'Les refusées n’ont pas bougé'} ; elles restent cochées.`}
            </p>
          )}
        </div>
        <Fermer onFermer={onFermer} />
      </div>

      {refus.length > 0 && (
        <div className="mt-3 ml-8 flex flex-col gap-2.5">
          {[...parMotif.entries()].map(([motif, liste]) => (
            <div key={motif} className="rounded-xl bg-white/70 border border-[#C9C1B1]/50 px-3 py-2.5">
              <p className="text-[13px] font-semibold text-[#1B2632]">{motif}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {liste.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1.5 text-xs bg-[#EEE9DF] rounded-md px-2 py-1">
                    <span className="font-mono font-semibold">{r.lead || '?'}</span>
                    {r.client && <span className="text-[#1B2632]/60">{r.client}</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Range la réponse de la base. `lignes` = les commandes de l'écran (pour le
// n° de lead et le client de chaque refus).
export function resumerLot(action, reponse, lignes) {
  const parId = new Map((lignes || []).map((c) => [c.id, c]))
  const refus = (reponse || [])
    .filter((r) => r.resultat === 'refuse')
    .map((r) => ({ id: r.commande_id, lead: parId.get(r.commande_id)?.lead_id, client: parId.get(r.commande_id)?.client_nom, motif: r.motif }))
  return {
    action,
    appliques: (reponse || []).filter((r) => r.resultat === 'applique').length,
    inchanges: (reponse || []).filter((r) => r.resultat === 'inchange').length,
    refus,
  }
}
