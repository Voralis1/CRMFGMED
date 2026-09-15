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

  const payload = await req.json()
  const {
    lead_id, client_nom, client_telephone, produit,
    ville_zone, source_url, statut_confirmation,
    notes, commentaire_1, commentaire_2, whatsapp_tracking,
    whatsapp_followup, quantite, source_sheet, tenant_id
  } = payload

  if (!client_telephone) {
    return new Response(JSON.stringify({ error: 'telephone requis' }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }

  if (!tenant_id) {
    return new Response(JSON.stringify({ error: 'tenant_id requis pour l\'isolation multi-tenant' }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }

  // Vérification de l'unicité par lead_id et par tenant
  const { data: existant } = await supabase
    .from('commandes')
    .select('id')
    .eq('lead_id', lead_id)
    .eq('tenant_id', tenant_id)
    .maybeSingle()

  if (existant) {
    return new Response(JSON.stringify({ status: 'deja_importe', id: existant.id }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }

  // 1. Insertion de la commande avec le tenant_id
  const { data: commande, error } = await supabase
    .from('commandes')
    .insert({
      lead_id, 
      client_nom, 
      client_telephone, 
      produit,
      ville_zone, 
      source_url, 
      statut_confirmation: statut_confirmation || 'en_attente',
      notes, 
      commentaire_1, 
      commentaire_2, 
      whatsapp_tracking,
      whatsapp_followup, 
      quantite: quantite || 1,
      source_sheet, 
      source: 'google_sheet',
      tenant_id // 👈 Rattaché à l'entreprise
    })
    .select()
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }

  // 2. Création automatique de l'entrée dans 'appels' avec le tenant_id
  await supabase.from('appels').insert({ 
    commande_id: commande.id, 
    statut: 'en_attente',
    tenant_id // 👈 Rattaché à l'entreprise également
  })

  return new Response(JSON.stringify({ status: 'ok', commande }), { 
    status: 200, 
    headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
  })
})