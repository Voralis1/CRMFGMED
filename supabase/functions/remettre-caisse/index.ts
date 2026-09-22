// Validate a driver's cash handover for one currency (encaisse -> remis).
// Allowed: `valider_remise` (manager, admin) + super_admin.
import { adminClient, assertTenant, getCaller, handle, HttpError, json, readJson, requireAny } from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['valider_remise'])

  const { livreur_id, devise } = await readJson(req) as { livreur_id?: string; devise?: string }
  if (!livreur_id) throw new HttpError(400, 'livreur_id requis')
  if (!devise) throw new HttpError(400, 'devise requise')

  const { data: livreur } = await sb.from('livreurs').select('id, tenant_id').eq('id', livreur_id).maybeSingle()
  if (!livreur) throw new HttpError(404, 'Livreur introuvable')
  assertTenant(caller, livreur.tenant_id)

  const { data: candidats, error: erreurLecture } = await sb
    .from('paiements')
    .select('id, montant, commandes(pays(devise))')
    .eq('livreur_id', livreur_id)
    .eq('tenant_id', livreur.tenant_id)
    .eq('statut', 'encaisse')
  if (erreurLecture) throw new HttpError(400, erreurLecture.message)

  // Never mix currencies in one handover.
  // deno-lint-ignore no-explicit-any
  const ids = (candidats || []).filter((p: any) => p.commandes?.pays?.devise === devise).map((p) => p.id)
  if (ids.length === 0) return json({ status: 'ok', nombre_paiements: 0, total_remis: 0, devise })

  const { data: paiements, error } = await sb
    .from('paiements')
    .update({ statut: 'remis' })
    .in('id', ids)
    .eq('statut', 'encaisse')
    .select()
  if (error) throw new HttpError(400, error.message)

  const total = (paiements || []).reduce((s, p) => s + Number(p.montant), 0)
  return json({ status: 'ok', nombre_paiements: paiements?.length ?? 0, total_remis: total, devise })
}))