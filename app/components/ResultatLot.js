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
export default function ResultatLot({ resultat, onFermer }) {
  if (!resultat) return null

  if (resultat.erreur) {
    return (
      <div className="rounded-2xl border border-[#A35139] bg-[#A35139]/5 p-4 text-sm text-[#1B2632]">
        <div className="flex items-start justify-between gap-3">
          <p>
            <b className="text-[#A35139]">{resultat.action} : rien n'a été appliqué.</b>{' '}
            {resultat.erreur}
          </p>
          <button onClick={onFermer} className="text-xs font-semibold text-[#1B2632]/50 hover:text-[#A35139] shrink-0">Fermer</button>
        </div>
      </div>
    )
  }

  const { appliques, inchanges, refus } = resultat
  return (
    <div className={`rounded-2xl border p-4 text-sm text-[#1B2632] ${refus.length ? 'border-[#A35139] bg-[#A35139]/5' : 'border-[#C9C1B1] bg-[#EEE9DF]/40'}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          {resultat.action} : {appliques} appliqué{appliques > 1 ? 's' : ''}
          {inchanges > 0 && <> · {inchanges} déjà ainsi</>}
          {refus.length > 0 && <span className="text-[#A35139]"> · {refus.length} refusé{refus.length > 1 ? 's' : ''}</span>}
        </p>
        <button onClick={onFermer} className="text-xs font-semibold text-[#1B2632]/50 hover:text-[#A35139] shrink-0">Fermer</button>
      </div>
      {refus.length > 0 && (
        <>
          <p className="text-xs text-[#1B2632]/60 mt-1">
            Les autres sont faits. Ceux-ci n'ont pas bougé et restent cochés :
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {refus.map((r) => (
              <li key={r.id} className="text-xs">
                <span className="font-mono font-semibold">#{r.lead || '?'}</span>
                {r.client && <span className="text-[#1B2632]/70"> — {r.client}</span>}
                <span className="text-[#A35139]"> : {r.motif}</span>
              </li>
            ))}
          </ul>
        </>
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
