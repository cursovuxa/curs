import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = Number(process.env.PORT || 10000);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'https://flowtix.online';
const supabase = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === frontendOrigin || origin === 'https://www.flowtix.online') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  if (!supabase) return res.status(503).json({ status: 'misconfigured', database: false });
  const { error } = await supabase.from('events').select('id', { head: true, count: 'exact' }).limit(1);
  res.status(error ? 503 : 200).json({ status: error ? 'database_error' : 'ok', database: !error });
});

app.get('/api/events', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Database is not configured' });
  const term = String(req.query.q || '').trim().slice(0, 100);
  const city = String(req.query.city || '').trim().slice(0, 100);
  let query = supabase.from('events')
    .select('id,title,description,cover_image,start_date,start_time,end_time,base_price,current_price,total_seats,available_seats,status,age_limit,dynamic_pricing_enabled,popularity_score,venue_id,category_id,event_categories(name),venues(name,address,city),event_program(*)')
    .eq('status', 'published').order('start_date', { ascending: true });
  if (term) query = query.ilike('title', '%' + term.replace(/[,%()]/g, '') + '%');
  if (city) query = query.ilike('venues.city', city);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Не удалось загрузить мероприятия' });
  res.json({ events: data });
});

app.get('/api/events/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Database is not configured' });
  const { data, error } = await supabase.from('events')
    .select('*,event_categories(name),venues(*),halls(*),event_program(*)')
    .eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error) return res.status(500).json({ error: 'Не удалось загрузить мероприятие' });
  if (!data) return res.status(404).json({ error: 'Мероприятие не найдено' });
  res.json({ event: data });
});

app.listen(port, '0.0.0.0', () => console.log('EventHub API listening on ' + port));
