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

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const requireUser = asyncRoute(async (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !supabase) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: 'Сессия недействительна' });
  let { data: profile, error } = await supabase.from('users').select('*').eq('id', authData.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Не удалось проверить профиль' });
  if (!profile) {
    const created = await supabase.from('users').insert({
      id: authData.user.id, email: authData.user.email,
      full_name: authData.user.user_metadata?.full_name || ''
    }).select('*').single();
    profile = created.data;
    error = created.error;
  }
  if (error || !profile) return res.status(500).json({ error: 'Не удалось создать профиль' });
  if (profile.is_blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  req.user = profile;
  next();
});
const allowRoles = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Недостаточно прав' });

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const fullName = String(req.body.fullName || '').trim().slice(0, 120);
  if (!email || password.length < 8 || !fullName) return res.status(400).json({ error: 'Укажите имя, email и пароль минимум из 8 символов' });
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) return res.status(400).json({ error: error.message });
  if (data.user) {
    const { error: profileError } = await supabase.from('users').upsert({
      id: data.user.id, email, full_name: fullName, role: 'visitor'
    }, { onConflict: 'id' });
    if (profileError) return res.status(500).json({ error: 'Аккаунт создан, но профиль не записан' });
  }
  res.status(data.session ? 201 : 202).json({
    message: data.session ? 'Аккаунт создан' : 'Проверьте почту и подтвердите адрес для входа',
    accessToken: data.session?.access_token || null,
    user: data.user ? { id: data.user.id, email: data.user.email, fullName } : null
  });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(req.body.email || '').trim().toLowerCase(),
    password: String(req.body.password || '')
  });
  if (error || !data.session) return res.status(401).json({ error: 'Неверный email или пароль' });
  const { data: profile, error: profileError } = await supabase.from('users')
    .select('id,email,full_name,role,is_blocked').eq('id', data.user.id).maybeSingle();
  if (profileError) return res.status(500).json({ error: 'Не удалось загрузить профиль' });
  if (profile?.is_blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  res.json({ accessToken: data.session.access_token, user: profile });
}));
app.get('/api/me', requireUser, (req, res) => res.json({ user: req.user }));

app.get('/api/favorites', requireUser, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('favorites')
    .select('event_id,events(id,title,description,cover_image,start_date,start_time,base_price,venues(name,city))')
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить избранное' });
  res.json({ favorites: data });
}));
app.post('/api/favorites/:eventId', requireUser, asyncRoute(async (req, res) => {
  const { error } = await supabase.from('favorites').insert({ user_id: req.user.id, event_id: req.params.eventId });
  if (error && error.code !== '23505') return res.status(400).json({ error: 'Не удалось добавить мероприятие' });
  res.status(201).json({ success: true });
}));
app.delete('/api/favorites/:eventId', requireUser, asyncRoute(async (req, res) => {
  const { error } = await supabase.from('favorites').delete().eq('user_id', req.user.id).eq('event_id', req.params.eventId);
  if (error) return res.status(500).json({ error: 'Не удалось удалить мероприятие' });
  res.json({ success: true });
}));
app.post('/api/complaints', requireUser, asyncRoute(async (req, res) => {
  const { targetType, targetId, reason, details } = req.body;
  if (!reason || !details) return res.status(400).json({ error: 'Укажите причину и подробности' });
  const { data, error } = await supabase.from('complaints').insert({
    author_id: req.user.id, target_type: targetType || 'event',
    target_id: targetId || null, reason: String(reason).slice(0, 200),
    details: String(details).slice(0, 4000), status: 'new'
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось отправить жалобу' });
  res.status(201).json({ complaint: data });
}));
app.get('/api/notifications', requireUser, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('notifications').select('*')
    .eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить уведомления' });
  res.json({ notifications: data });
}));
app.patch('/api/notifications/:id/read', requireUser, asyncRoute(async (req, res) => {
  const { error } = await supabase.from('notifications').update({ is_read: true })
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(400).json({ error: 'Не удалось отметить уведомление' });
  res.json({ success: true });
}));

app.post('/api/events', requireUser, allowRoles('organizer', 'admin'), asyncRoute(async (req, res) => {
  const { title, description, category_id, venue_id, hall_id, start_date, start_time, end_time, age_limit, total_seats, base_price, cover_image } = req.body;
  if (!title || !start_date || !start_time || !end_time || !Number.isInteger(Number(total_seats)) || Number(total_seats) < 1) {
    return res.status(400).json({ error: 'Заполните название, даты, время и вместимость' });
  }
  const { data, error } = await supabase.from('events').insert({
    organizer_id: req.user.id, title: String(title).slice(0, 180),
    description: String(description || '').slice(0, 10000),
    category_id: category_id || null, venue_id: venue_id || null, hall_id: hall_id || null,
    start_date, start_time, end_time, age_limit: age_limit || 'Для всех',
    total_seats: Number(total_seats), available_seats: Number(total_seats),
    base_price: Number(base_price || 0), current_price: Number(base_price || 0),
    cover_image: cover_image || null, status: 'pending_moderation'
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось создать мероприятие' });
  res.status(201).json({ event: data });
}));
app.get('/api/organizer/events', requireUser, allowRoles('organizer', 'admin'), asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('events').select('*,venues(name,city),event_categories(name)')
    .eq('organizer_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить мероприятия организатора' });
  res.json({ events: data });
}));
app.patch('/api/events/:id', requireUser, allowRoles('organizer', 'admin'), asyncRoute(async (req, res) => {
  const changes = {};
  for (const key of ['title','description','category_id','venue_id','hall_id','start_date','start_time','end_time','age_limit','total_seats','base_price','cover_image']) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  const { data, error } = await supabase.from('events').update(changes)
    .eq('id', req.params.id).eq('organizer_id', req.user.id).select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'Не удалось изменить мероприятие' });
  if (!data) return res.status(404).json({ error: 'Мероприятие не найдено' });
  res.json({ event: data });
}));
app.get('/api/moderation/events', requireUser, allowRoles('moderator', 'admin'), asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('events').select('*,venues(name,city),users!events_organizer_id_fkey(full_name,email)')
    .eq('status', 'pending_moderation').order('created_at');
  if (error) return res.status(500).json({ error: 'Не удалось загрузить очередь модерации' });
  res.json({ events: data });
}));
app.patch('/api/moderation/events/:id', requireUser, allowRoles('moderator', 'admin'), asyncRoute(async (req, res) => {
  const status = req.body.status;
  if (!['published', 'rejected'].includes(status)) return res.status(400).json({ error: 'Недопустимое решение' });
  const { data, error } = await supabase.from('events').update({ status })
    .eq('id', req.params.id).eq('status', 'pending_moderation').select('id,status').maybeSingle();
  if (error) return res.status(400).json({ error: 'Не удалось обновить статус' });
  if (!data) return res.status(404).json({ error: 'Заявка не найдена' });
  res.json({ event: data });
}));
app.patch('/api/admin/users/:id/block', requireUser, allowRoles('admin'), asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('users').update({ is_blocked: Boolean(req.body.blocked) })
    .eq('id', req.params.id).select('id,email,is_blocked').single();
  if (error) return res.status(400).json({ error: 'Не удалось изменить статус аккаунта' });
  res.json({ user: data });
}));
app.patch('/api/admin/users/:id/role', requireUser, allowRoles('admin'), asyncRoute(async (req, res) => {
  if (!['visitor','organizer','staff','moderator','admin'].includes(req.body.role)) return res.status(400).json({ error: 'Недопустимая роль' });
  const { data, error } = await supabase.from('users').update({ role: req.body.role })
    .eq('id', req.params.id).select('id,email,full_name,role').single();
  if (error) return res.status(400).json({ error: 'Не удалось изменить роль' });
  res.json({ user: data });
}));

app.use((err, _req, res, _next) => {
  console.error('[api]', err.message);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(port, '0.0.0.0', () => console.log('FlowTix API listening on ' + port));
const pingUrl = process.env.RENDER_EXTERNAL_URL;
if (pingUrl) {
  setInterval(() => {
    fetch(pingUrl.replace(/\/$/, '') + '/api/health')
      .then((response) => console.log('[keepalive] health ping ' + response.status))
      .catch((error) => console.error('[keepalive] failed:', error.message));
  }, 14 * 60 * 1000).unref();
}
