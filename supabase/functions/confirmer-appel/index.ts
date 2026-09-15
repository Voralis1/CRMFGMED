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

  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  const { data: { user }, error: erreurUser } = await supabase.auth.getUser(token)
  
  if (erreurUser || !user) {
    return new Response(JSON.stringify({ error: 'Non authentifié' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('roles(nom)')
    .eq('user_id', user.id)
    .maybeSingle()

  const roleNom = roleData?.roles?.nom?.toLowerCase()

  if (!roleNom || (roleNom !== 'admin' && roleNom !== 'agent' && roleNom !== 'super_admin')) {
    return new Response(JSON.stringify({ error: 'Accès refusé : rôle insuffisant' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payload = await req.json()
  
  const {
    commande_id, statut, notes, date_rappel, source, tenant_id,
    client_nom, client_telephone, ville_zone, zone_id, pays_id, produit, quantite, prix
  } = payload

  if (!commande_id || !statut || !tenant_id) {
    return new Response(JSON.stringify({ error: 'commande_id, statut et tenant_id requis' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 🚀 SUPPRESSION DE LA LISTE EN DUR !
  // On accepte désormais tous les statuts dynamiques provenant de l'interface.

  let agent_id = null
  if (roleNom === 'agent') {
    const { data: agentData } = await supabase
      .from('agents')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
    agent_id = agentData?.id || null
  } else {
    agent_id = payload.agent_id || null
  }

  // 1. JOURNALISATION DE L'APPEL
  const { data: appel, error: erreurAppel } = await supabase
    .from('appels')
    .insert({
      commande_id,
      agent_id,
      statut, // 🚀 Enregistre le nouveau statut dynamique (ex: "Reporté à demain")
      tenant_id, 
      notes: notes || null,
      // Si le nom du statut contient "rappel" ou "reminder", on garde la date
      date_rappel: (statut.toLowerCase().includes('rappel') || statut.toLowerCase().includes('reminder')) ? (date_rappel || null) : null
    })
    .select()
    .single()

  if (erreurAppel) {
    return new Response(JSON.stringify({ error: erreurAppel.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 2. MISE À JOUR DE LA COMMANDE
  const { error: erreurCommande } = await supabase
    .from('commandes')
    .update({
      statut_confirmation: statut, // 🚀 Met à jour le statut dynamique sur la commande
      source: source || null,
      client_nom: client_nom,
      client_telephone: client_telephone,
      ville_zone: ville_zone,
      zone_id: zone_id || null,
      pays_id: pays_id || null,
      produit: produit,
      quantite: Math.max(1, parseInt(quantite) || 1),
      prix: parseFloat(prix) || 0, 
      updated_at: new Date().toISOString()
    })
    .eq('id', commande_id)

  if (erreurCommande) {
    return new Response(JSON.stringify({ error: erreurCommande.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ status: 'ok', appel }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})