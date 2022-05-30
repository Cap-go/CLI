import { createClient } from '@supabase/supabase-js'

const supaUrl = 'https://aucsybvnhavogdmzwtcw.supabase.co'
const apikey = '***'
const anonKey = '***'
const init = async () => {
    const supabase = createClient(supaUrl, anonKey, {
        headers: {
            capgkey: '***',
        }
    })
    const { data: userId } = await supabase
        .rpc('get_user_id', { apikey })
    console.log('userId', userId)
    const apps = await supabase.from('apps')
        .select()
        .eq('app_id', 'ee.forgr.captime')
    console.log('apps', apps.data)
    // try to find one app
}

init()
// (is_app_shared(uid(), app_id) OR is_allowed_apikey((((current_setting('request.headers'::text, true))::json ->> 'capgkey'::text))::character varying, '{read}'::key_mode[]))
// is_allowed_apikey(((current_setting('request.headers'::text, true))::json ->> 'capgkey'::text), '{read}'::key_mode[])

// (((current_setting('request.headers'::text, true))::json ->> 'capgkey'::text) = 'dKC9teP4zHh7Lr5ak7hErgYn385C'::text)