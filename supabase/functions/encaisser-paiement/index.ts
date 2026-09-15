import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Vérification de la session
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  const { data: { user }, error: erreurUser } = await supabase.auth.getUser(token)

  if (erreurUser || !user) {
    return new Response(JSON.stringify({ error: 'Non authentifié' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 🚀 CORRECTION : Utilisation de la relation avec la table "roles" (nom)
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('roles(nom)')
    .eq('user_id', user.id)
    .maybeSingle()

  const roleNom = roleData?.roles?.nom?.toLowerCase()

  if (!roleNom || (roleNom !== 'admin' && roleNom !== 'livreur' && roleNom !== 'super_admin')) {
    return new Response(JSON.stringify({ error: 'Accès refusé : rôle insuffisant' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payload = await req.json()
  const { paiement_id } = payload

  if (!paiement_id) {
    return new Response(JSON.stringify({ error: 'paiement_id requis' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: paiement, error: erreurLecture } = await supabase
    .from('paiements')
    .select('id, commande_id, statut')
    .eq('id', paiement_id)
    .single()

  if (erreurLecture || !paiement) {
    return new Response(JSON.stringify({ error: 'paiement introuvable' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (paiement.statut !== 'en_attente') {
    return new Response(JSON.stringify({ error: 'ce paiement n\'est pas en attente' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { error: erreurUpdate } = await supabase
    .from('paiements')
    .update({ statut: 'encaisse', date_encaissement: new Date().toISOString() })
    .eq('id', paiement_id)

  if (erreurUpdate) {
    return new Response(JSON.stringify({ error: erreurUpdate.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await supabase
    .from('commandes')
    .update({ statut_paiement: 'paye' })
    .eq('id', paiement.commande_id)

  return new Response(JSON.stringify({ status: 'ok', paiement_id }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})