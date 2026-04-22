import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xtxzfhoxyyrlxslgzvty.supabase.co'
const SUPABASE_KEY = 'sb_publishable_roSzL0VOILmeVZLN-mdLSQ_G5-zOpu8'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
