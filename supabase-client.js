import { createClient } from
  'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL =
  'https://mqbqbuexisctrkfzwzwy.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_fZXYokcypzn-xdyygKBYgQ_hWPhNH_Z';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);