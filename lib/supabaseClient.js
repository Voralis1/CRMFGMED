// Ce fichier crée UNE SEULE connexion à Supabase, réutilisée partout dans l'app.
// C'est l'équivalent de la "Datasource" qu'on créait dans Appsmith.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
