import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'

const SUPABASE_URL = 'https://xtxzfhoxyyrlxslgzvty.supabase.co'
const SUPABASE_KEY = 'sb_publishable_roSzL0VOILmeVZLN-mdLSQ_G5-zOpu8'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
