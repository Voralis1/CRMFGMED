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

  try {
    const { user_id } = await req.json()

    if (!user_id) {
      throw new Error("L'identifiant utilisateur (user_id) est requis.")
    }

    // 1. Dissocier ou nettoyer les tables métiers pour éviter les erreurs de contraintes
    await supabase.from('agents').update({ user_id: null }).eq('user_id', user_id)
    await supabase.from('livreurs').update({ user_id: null }).eq('user_id', user_id)
    
    // 2. Supprimer le rôle
    await supabase.from('user_roles').delete().eq('user_id', user_id)

    // 3. Supprimer le compte dans Supabase Auth
    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(user_id)
    if (deleteAuthError) throw deleteAuthError

    return new Response(JSON.stringify({ status: 'ok', message: 'Compte supprimé avec succès' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})