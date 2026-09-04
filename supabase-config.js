const SUPABASE_URL = 'https://gdmevluvrmexkkihcxce.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkbWV2bHV2cm1leGtraWhjeGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NTI5ODIsImV4cCI6MjEwNDEyODk4Mn0.U1MA6q_GfuPpzkJCvMwTc07neAek1vsq5qWE44_eYQQ';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabaseClient;
window.supabase = supabaseClient;
