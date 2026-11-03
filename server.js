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
      full_name: authData.user.user_metadata?.full_name || '',
      role: (process.env.FLOWTIX_ADMIN_EMAIL || '').toLowerCase() === String(authData.user.email || '').toLowerCase() ? 'admin' : 'visitor'
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
      id: data.user.id, email, full_name: fullName,
      role: (process.env.FLOWTIX_ADMIN_EMAIL || '').toLowerCase() === email ? 'admin' : 'visitor'
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
app.patch('/api/me/profile', requireUser, asyncRoute(async (req, res) => {
  const full_name = String(req.body.full_name || '').trim().slice(0, 120);
  const phone = String(req.body.phone || '').trim().slice(0, 40);
  const city = String(req.body.city || '').trim().slice(0, 100);
  const about = String(req.body.about || '').trim().slice(0, 1000);
  if (!full_name) return res.status(400).json({ error: 'Укажите имя для профиля' });
  const preferences = { ...(req.user.preferences || {}), about };
  const { data, error } = await supabase.from('users')
    .update({ full_name, phone: phone || null, city: city || null, preferences })
    .eq('id', req.user.id)
    .select('id,email,full_name,phone,city,preferences')
    .single();
  if (error) return res.status(500).json({ error: 'Не удалось сохранить профиль' });
  res.json({ user: data });
}));
app.patch('/api/me/preferences', requireUser, asyncRoute(async (req, res) => {
  const theme = String(req.body.theme || '');
  if (!['rose', 'sky', 'dark', 'halloween'].includes(theme)) {
    return res.status(400).json({ error: 'Неизвестная тема оформления' });
  }
  const preferences = { ...(req.user.preferences || {}), theme };
  const { data, error } = await supabase.from('users')
    .update({ preferences }).eq('id', req.user.id).select('preferences').single();
  if (error) return res.status(500).json({ error: 'Не удалось сохранить тему аккаунта' });
  req.user.preferences = data.preferences;
  res.json({ preferences: data.preferences });
}));

app.get('/api/favorites', requireUser, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('favorites')
    .select('event_id,events(id,title,description,cover_image,start_date,start_time,base_price,venues(name,city))')
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить избранное' });
  res.json({ favorites: data });
}));
app.post('/api/favorites/:eventId', requireUser, asyncRoute(async (req, res) => {
  const { data: existing } = await supabase.from('favorites').select('id').eq('user_id', req.user.id).eq('event_id', req.params.eventId).maybeSingle();
  if (existing) return res.json({ success: true });
  const { error } = await supabase.from('favorites').insert({ user_id: req.user.id, event_id: req.params.eventId });
  if (error) return res.status(400).json({ error: 'Не удалось добавить мероприятие' });
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
  if (data.role === 'staff') {
    const { data: employee } = await supabase.from('employees').select('id').eq('user_id', data.id).maybeSingle();
    if (!employee) await supabase.from('employees').insert({ user_id: data.id, position: 'Сотрудник мероприятия' });
  }
  res.json({ user: data });
}));

app.post('/api/registrations', requireUser, asyncRoute(async (req, res) => {
  const eventId = String(req.body.eventId || '');
  const { data, error } = await supabase.rpc('register_for_event', { p_user_id: req.user.id, p_event_id: eventId });
  if (error) {
    const reason = error.message || '';
    const status = reason.includes('payment_provider_required') ? 501
      : reason.includes('already_registered') ? 409
      : reason.includes('sold_out') ? 409 : 400;
    const message = reason.includes('payment_provider_required') ? 'Платёжный провайдер ещё не подключён; платные регистрации закрыты'
      : reason.includes('already_registered') ? 'Вы уже зарегистрированы'
      : reason.includes('sold_out') ? 'Свободных мест больше нет' : 'Не удалось зарегистрироваться';
    return res.status(status).json({ error: message });
  }
  await supabase.from('audit_logs').insert({
    actor_id: req.user.id, actor_name: req.user.full_name,
    action: 'REGISTER_FOR_EVENT', entity_type: 'ticket',
    entity_id: data.ticket.id, details: { event_id: eventId }
  });
  res.status(201).json(data);
}));
app.get('/api/tickets/mine', requireUser, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('tickets')
    .select('*,events(id,title,start_date,start_time,venues(name,city))')
    .eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить билеты' });
  res.json({ tickets: data });
}));
app.post('/api/reviews', requireUser, asyncRoute(async (req, res) => {
  const { eventId, orgRating, venueRating, programRating, staffRating, comment } = req.body;
  const ratings = [orgRating, venueRating, programRating, staffRating].map(Number);
  if (!eventId || ratings.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) {
    return res.status(400).json({ error: 'Оцените организатора, площадку, программу и команду (1–5)' });
  }
  const { count } = await supabase.from('tickets').select('id', { count: 'exact', head: true })
    .eq('event_id', eventId).eq('user_id', req.user.id).in('status', ['valid', 'used']);
  if (!count) return res.status(403).json({ error: 'Оставлять отзыв могут участники с билетом' });
  const { data: prior } = await supabase.from('reviews').select('id').eq('event_id', eventId).eq('user_id', req.user.id).maybeSingle();
  if (prior) return res.status(409).json({ error: 'Вы уже оставили отзыв на это событие' });
  const { data, error } = await supabase.from('reviews').insert({
    event_id: eventId, user_id: req.user.id,
    org_rating: ratings[0], venue_rating: ratings[1], program_rating: ratings[2],
    staff_rating: ratings[3], overall_rating: ratings.reduce((a,b) => a+b, 0) / 4,
    comment: String(comment || '').slice(0, 3000)
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'Отзыв уже оставлен или данные некорректны' });
  res.status(201).json({ review: data });
}));
app.get('/api/organizer/registrations', requireUser, allowRoles('organizer', 'admin'), asyncRoute(async (req, res) => {
  const { data: events, error: eventsError } = await supabase.from('events').select('id').eq('organizer_id', req.user.id);
  if (eventsError) return res.status(500).json({ error: 'Не удалось загрузить мероприятия' });
  const ids = (events || []).map((event) => event.id);
  if (!ids.length) return res.json({ registrations: [] });
  const { data, error } = await supabase.from('tickets')
    .select('ticket_number,status,seat_label,price_paid,created_at,events(id,title),users(full_name,email)')
    .in('event_id', ids).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить участников' });
  res.json({ registrations: data });
}));
app.get('/api/staff/assignments', requireUser, allowRoles('staff', 'admin'), asyncRoute(async (req, res) => {
  if (req.user.role === 'admin') {
    const { data, error } = await supabase.from('event_staff_assignments')
      .select('*,events(id,title,start_date,start_time,venues(name,city)),employees(user_id,position,users(full_name,email))');
    if (error) return res.status(500).json({ error: 'Не удалось загрузить назначения' });
    return res.json({ assignments: data });
  }
  const { data: employee, error: employeeError } = await supabase.from('employees').select('id').eq('user_id', req.user.id).maybeSingle();
  if (employeeError || !employee) return res.json({ assignments: [] });
  const { data, error } = await supabase.from('event_staff_assignments')
    .select('*,events(id,title,start_date,start_time,venues(name,city))')
    .eq('employee_id', employee.id).eq('status', 'assigned');
  if (error) return res.status(500).json({ error: 'Не удалось загрузить назначения' });
  res.json({ assignments: data });
}));
app.post('/api/staff/tickets/:ticketNumber/check-in', requireUser, allowRoles('staff', 'admin'), asyncRoute(async (req, res) => {
  let q = supabase.from('tickets').select('id,event_id,status,user_id').eq('ticket_number', req.params.ticketNumber).maybeSingle();
  const { data: ticket, error } = await q;
  if (error || !ticket) return res.status(404).json({ error: 'Билет не найден' });
  if (ticket.status !== 'valid') return res.status(409).json({ error: ticket.status === 'used' ? 'Билет уже использован' : 'Билет недействителен' });
  if (req.user.role === 'staff') {
    const { data: emp } = await supabase.from('employees').select('id').eq('user_id', req.user.id).maybeSingle();
    if (!emp) return res.status(403).json({ error: 'Сотрудник не назначен на это мероприятие' });
    const { data: assignment } = await supabase.from('event_staff_assignments').select('id')
      .eq('event_id', ticket.event_id).eq('employee_id', emp.id).eq('status', 'assigned').maybeSingle();
    if (!assignment) return res.status(403).json({ error: 'У вас нет доступа к мероприятию' });
  }
  const { data: checked, error: checkError } = await supabase.from('tickets')
    .update({ status: 'used', used_at: new Date().toISOString(), used_by_staff_id: req.user.id })
    .eq('id', ticket.id).eq('status', 'valid').select('id,ticket_number,status,used_at').maybeSingle();
  if (checkError) return res.status(500).json({ error: 'Не удалось отметить вход' });
  if (!checked) return res.status(409).json({ error: 'Билет уже проверен' });
  res.json({ ticket: checked });
}));
app.get('/api/moderation/complaints', requireUser, allowRoles('moderator', 'admin'), asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('complaints').select('*,users!complaints_author_id_fkey(full_name,email)')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить жалобы' });
  res.json({ complaints: data });
}));
app.patch('/api/moderation/complaints/:id', requireUser, allowRoles('moderator', 'admin'), asyncRoute(async (req, res) => {
  if (!['in_review','resolved','rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Недопустимый статус' });
  const { data, error } = await supabase.from('complaints').update({
    status: req.body.status, moderator_notes: String(req.body.moderatorNotes || '').slice(0, 3000),
    reviewed_by: req.user.id, updated_at: new Date().toISOString()
  }).eq('id', req.params.id).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось обновить жалобу' });
  res.json({ complaint: data });
}));
app.get('/api/admin/audit-logs', requireUser, allowRoles('admin'), asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить журнал' });
  res.json({ logs: data });
}));
app.get('/api/admin/statistics', requireUser, allowRoles('admin'), asyncRoute(async (_req, res) => {
  const [users, events, tickets, payments, complaints] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('events').select('id', { count: 'exact', head: true }),
    supabase.from('tickets').select('id', { count: 'exact', head: true }),
    supabase.from('payments').select('amount', { count: 'exact' }).eq('status', 'completed'),
    supabase.from('complaints').select('id', { count: 'exact', head: true }).in('status', ['new','in_review'])
  ]);
  if ([users,events,tickets,payments,complaints].some((x) => x.error)) return res.status(500).json({ error: 'Не удалось рассчитать статистику' });
  const revenue = (payments.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  res.json({ users: users.count, events: events.count, tickets: tickets.count, revenue, openComplaints: complaints.count });
}));

app.get('/api/categories', asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('event_categories').select('id,name,slug,icon').order('name');
  if (error) return res.status(500).json({ error: 'Не удалось загрузить категории' });
  res.json({ categories: data });
}));
app.get('/api/venues', asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('venues').select('id,name,city,address').order('city');
  if (error) return res.status(500).json({ error: 'Не удалось загрузить площадки' });
  res.json({ venues: data });
}));
app.post('/api/venues', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { name, city, address, description } = req.body;
  if (!name || !city || !address) return res.status(400).json({ error: 'Заполните название, город и адрес' });
  const { data, error } = await supabase.from('venues').insert({
    owner_id: req.user.id, name: String(name).slice(0,160), city: String(city).slice(0,100),
    address: String(address).slice(0,240), description: String(description || '').slice(0,3000)
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось создать площадку' });
  res.status(201).json({ venue: data });
}));
app.get('/api/organizer/venues', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('venues').select('*').eq('owner_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить ваши площадки' });
  res.json({ venues: data });
}));
app.post('/api/organizer/events/:eventId/staff', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { data: event } = await supabase.from('events').select('id').eq('id', req.params.eventId).eq('organizer_id', req.user.id).maybeSingle();
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const employeeId = String(req.body.employeeId || '');
  const { data: existing } = await supabase.from('event_staff_assignments').select('id')
    .eq('event_id', event.id).eq('employee_id', employeeId).maybeSingle();
  const write = existing
    ? await supabase.from('event_staff_assignments').update({ role_at_event: String(req.body.role || 'staff'), status: 'assigned' }).eq('id', existing.id).select('*').single()
    : await supabase.from('event_staff_assignments').insert({ event_id: event.id, employee_id: employeeId, role_at_event: String(req.body.role || 'staff'), status: 'assigned' }).select('*').single();
  if (write.error) return res.status(400).json({ error: 'Не удалось назначить сотрудника' });
  res.status(201).json({ assignment: write.data });
}));
app.post('/api/organizer/events/:eventId/notify', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { data: event } = await supabase.from('events').select('id,title').eq('id', req.params.eventId).eq('organizer_id', req.user.id).maybeSingle();
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const title = String(req.body.title || event.title).slice(0,160);
  const message = String(req.body.message || '').slice(0,2000);
  if (!message) return res.status(400).json({ error: 'Введите текст уведомления' });
  const { data: attendees, error: attendeeError } = await supabase.from('tickets').select('user_id').eq('event_id', event.id);
  if (attendeeError) return res.status(500).json({ error: 'Не удалось получить список участников' });
  const ids = [...new Set((attendees || []).map((row) => row.user_id))];
  if (!ids.length) return res.json({ sent: 0 });
  const { error } = await supabase.from('notifications').insert(ids.map((user_id) => ({
    user_id, title, message, type: 'event_update', channel: 'in_app'
  })));
  if (error) return res.status(500).json({ error: 'Не удалось отправить уведомления' });
  res.json({ sent: ids.length });
}));
app.get('/api/admin/users', requireUser, allowRoles('admin'), asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('users').select('id,email,full_name,role,is_blocked,created_at').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить пользователей' });
  res.json({ users: data });
}));

app.get('/api/organizer/employees', requireUser, allowRoles('organizer','admin'), asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('employees')
    .select('id,position,qualification,users!employees_user_id_fkey(id,full_name,email)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить сотрудников' });
  res.json({ employees: data });
}));
app.post('/api/events/:eventId/program', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { data: event } = await supabase.from('events').select('id')
    .eq('id', req.params.eventId).eq('organizer_id', req.user.id).maybeSingle();
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const { title, start_time, end_time, speaker_name, room_name, description } = req.body;
  if (!title || !start_time || !end_time) return res.status(400).json({ error: 'Заполните название и время пункта расписания' });
  const { data, error } = await supabase.from('event_program').insert({
    event_id: event.id, title: String(title).slice(0,180), start_time, end_time,
    speaker_name: String(speaker_name || '').slice(0,160),
    room_name: String(room_name || '').slice(0,120),
    description: String(description || '').slice(0,2000)
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось добавить пункт расписания' });
  res.status(201).json({ item: data });
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
