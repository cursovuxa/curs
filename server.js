import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 10000);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rootAdminEmail = String(process.env.FLOWTIX_ROOT_ADMIN_EMAIL || '').trim().toLowerCase();
const paymentProviderName = String(process.env.PAYMENT_PROVIDER_NAME || '').trim();
const paymentCreateUrl = String(process.env.PAYMENT_PROVIDER_CREATE_URL || '').trim();
const paymentApiKey = String(process.env.PAYMENT_PROVIDER_API_KEY || '');
const paymentWebhookSecret = String(process.env.PAYMENT_WEBHOOK_SECRET || '');
const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || 'https://flowtix.online').replace(/\/$/, '');
const renderPublicUrl = String(process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const paymentWebhookUrl = String(process.env.PAYMENT_WEBHOOK_URL || (renderPublicUrl ? renderPublicUrl + '/api/webhooks/payments' : '')).trim();
const paymentProviderReady = Boolean(paymentProviderName && paymentCreateUrl && paymentApiKey && paymentWebhookSecret && paymentWebhookUrl.startsWith('https://'));
const isRootEmail = (email) => Boolean(rootAdminEmail) && String(email || '').trim().toLowerCase() === rootAdminEmail;
const validRoles = new Set(['visitor', 'organizer', 'staff', 'moderator', 'admin']);
const normalizeOrigin = (value) => {
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
};
const frontendOrigins = new Set([
  ...String(process.env.FRONTEND_ORIGIN || 'https://flowtix.online')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean),
  'https://flowtix.online',
  'https://www.flowtix.online'
]);
const supabase = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
  if (normalizedOrigin && frontendOrigins.has(normalizedOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key,X-FlowTix-Signature');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '4mb', verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
app.use('/api', async (req, res, next) => {
  if (['/health','/auth/login','/auth/register','/webhooks/payments'].includes(req.path) || req.path.startsWith('/admin')) return next();
  try {
    const { data } = await supabase.from('platform_settings').select('value').eq('key', 'maintenance_mode').maybeSingle();
    if (data?.value !== true) return next();
    const token = req.get('authorization')?.replace(/^Bearer\\s+/i, '');
    if (token && supabase) {
      const { data: authData } = await supabase.auth.getUser(token);
      if (isRootEmail(authData.user?.email)) return next();
    }
    return res.status(503).json({ error: 'FlowTix временно на обслуживании. Попробуйте позже.' });
  } catch (error) {
    return next(error);
  }
});

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
    .select('id,title,description,cover_image,location_address,start_date,start_time,end_time,created_at,base_price,current_price,total_seats,available_seats,status,age_limit,rules,contact_email,contact_phone,dynamic_pricing_enabled,popularity_score,venue_id,category_id,organizer_id,event_categories(name),venues(name,address,city,latitude,longitude),event_program(*),users!events_organizer_id_fkey(id,full_name,username,avatar_url,avatar_path,role,city,preferences)')
    .eq('status', 'published').order('start_date', { ascending: true });
  if (term) query = query.ilike('title', '%' + term.replace(/[,%()]/g, '') + '%');
  if (city) query = query.ilike('venues.city', city);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Не удалось загрузить мероприятия' });
  let visibleEvents=data||[];
  const token=req.get('authorization')?.replace(/^Bearer\\s+/i,'');
  if(token){const auth=await supabase.auth.getUser(token);const viewer=auth.data?.user?.id;if(viewer){const organizerIds=[...new Set(visibleEvents.map(x=>x.organizer_id).filter(Boolean))];if(organizerIds.length){const blocks=await supabase.from('user_blocks').select('blocked_id').eq('blocker_id',viewer).in('blocked_id',organizerIds);const hidden=new Set((blocks.data||[]).map(x=>x.blocked_id));visibleEvents=visibleEvents.filter(x=>!hidden.has(x.organizer_id))}}}
  visibleEvents=await Promise.all(visibleEvents.map(async e=>{e.users=await signedUserAvatar(e.users);return e}));
  res.json({ events: visibleEvents });
});

app.get('/api/events/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Database is not configured' });
  const { data, error } = await supabase.from('events')
    .select('*,event_categories(name),venues(*),halls(*),event_program(*),users!events_organizer_id_fkey(id,full_name,username,avatar_url,avatar_path,role,city,preferences)')
    .eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error) return res.status(500).json({ error: 'Не удалось загрузить мероприятие' });
  if (!data) return res.status(404).json({ error: 'Мероприятие не найдено' });
  data.users=await signedUserAvatar(data.users);
  const token=req.get('authorization')?.replace(/^Bearer\\s+/i,'');if(token&&data.organizer_id){const auth=await supabase.auth.getUser(token);const viewer=auth.data?.user?.id;if(viewer&&viewer!==data.organizer_id){const block=await supabase.from('user_blocks').select('blocked_id').eq('blocker_id',viewer).eq('blocked_id',data.organizer_id).maybeSingle();if(block.data)return res.status(404).json({error:'Мероприятие не найдено'})}}
  res.json({ event: data });
});

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const requireUser = asyncRoute(async (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !supabase) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: 'Сессия недействительна' });
  const isRootAdmin = isRootEmail(authData.user.email);
  const appMetadata = authData.user.app_metadata || {};
  const claimRole = validRoles.has(appMetadata.flowtix_role) ? appMetadata.flowtix_role : 'visitor';
  const claimBlocked = appMetadata.flowtix_blocked === true;
  let { data: profile, error } = await supabase.from('users').select('*').eq('id', authData.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Не удалось проверить профиль' });
  if (!profile) {
    const created = await supabase.from('users').insert({
      id: authData.user.id, email: authData.user.email,
      full_name: authData.user.user_metadata?.full_name || '',
      username: (String(authData.user.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 15) || 'user') + '_' + authData.user.id.slice(0, 8),
      role: 'visitor'
    }).select('*').single();
    profile = created.data;
    error = created.error;
    if (!error && profile) {
      const claim = await supabase.auth.admin.updateUserById(authData.user.id, {
        app_metadata: { ...appMetadata, flowtix_role: isRootAdmin ? 'admin' : claimRole, flowtix_blocked: false }
      });
      if (claim.error) return res.status(500).json({ error: 'Не удалось создать защищённые права аккаунта' });
    }
  }
  if (error || !profile) return res.status(500).json({ error: 'Не удалось создать профиль' });
  const profileBlocked = !isRootAdmin && profile.is_blocked === true;
  if (!profile.username) {
    const base = String(authData.user.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 15) || 'user';
    const { data: namedProfile, error: usernameError } = await supabase.from('users')
      .update({ username: base + '_' + authData.user.id.slice(0, 8) }).eq('id', profile.id).select('*').single();
    if (!usernameError && namedProfile) profile = namedProfile;
  }
  profile = { ...profile, role: isRootAdmin ? 'admin' : claimRole, is_blocked: profileBlocked, is_root_admin: isRootAdmin };
  if (profileBlocked && !(req.method === 'GET' && req.path === '/api/me')) {
    return res.status(403).json({ code: 'ACCOUNT_BLOCKED', error: 'Аккаунт заблокирован' });
  }
  req.user = profile;
  next();
});
const allowRoles = (...roles) => (req, res, next) => {
  const allowed = roles.some((role) => role === 'admin'
    ? req.user.is_root_admin === true
    : req.user.role === role);
  return allowed ? next() : res.status(403).json({ error: 'Недостаточно прав' });
};
const requireRootAdmin = (req, res, next) => req.user.is_root_admin === true
  ? next()
  : res.status(403).json({ error: 'Доступ только главному администратору' });
async function createNotification(userId,title,message,type='account_activity',actionUrl=null){
  if(!supabase||!userId)return;
  try{
    const {error}=await supabase.from('notifications').insert({
      user_id:userId,title:String(title||'Уведомление FlowTix').slice(0,200),
      message:String(message||'').slice(0,2000),type,channel:'in_app',
      action_url:typeof actionUrl==='string'&&actionUrl.startsWith('/')?actionUrl.slice(0,500):null
    });
    if(error)console.error('[notifications] insert failed:',error.message);
  }catch(error){console.error('[notifications] insert failed:',error.message)}
}
async function notifyRootAdmin(title,message,type='admin_activity',actionUrl=null){
  if(!rootAdminEmail)return;
  const {data,error}=await supabase.from('users').select('id').eq('email',rootAdminEmail).maybeSingle();
  if(error){console.error('[notifications] root admin lookup failed:',error.message);return}
  if(data?.id)await createNotification(data.id,title,message,type,actionUrl);
}

app.get('/api/admin/access', requireUser, requireRootAdmin, (_req, res) => res.json({ allowed: true }));

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
    const { error: claimError } = await supabase.auth.admin.updateUserById(data.user.id, {
      app_metadata: { ...(data.user.app_metadata || {}), flowtix_role: isRootEmail(email) ? 'admin' : 'visitor', flowtix_blocked: false }
    });
    if (claimError) return res.status(500).json({ error: 'Аккаунт создан, но защищённые права не записаны' });
  }
  res.status(data.session ? 201 : 202).json({
    message: data.session ? 'Аккаунт создан' : 'Проверьте почту и подтвердите адрес для входа',
    accessToken: data.session?.access_token || null,
    refreshToken: data.session?.refresh_token || null,
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
  res.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: profile ? { ...profile, role: isRootEmail(data.user.email) ? 'admin' : (validRoles.has(data.user.app_metadata?.flowtix_role) ? data.user.app_metadata.flowtix_role : 'visitor'), is_blocked: !isRootEmail(data.user.email) && profile.is_blocked === true, is_root_admin: isRootEmail(data.user.email) } : null
  });
}));
app.get('/api/me', requireUser, asyncRoute(async (req, res) => {
  if (req.user.is_blocked) {
    return res.json({ user: { id: req.user.id, email: req.user.email, full_name: req.user.full_name, username: req.user.username, role: req.user.role, is_blocked: true, is_root_admin: false, preferences: req.user.preferences || {} } });
  }
  const profile = { ...req.user };
  delete profile.avatar_path;
  if (req.user.avatar_path) {
    const { data, error } = await supabase.storage.from('avatars').createSignedUrl(req.user.avatar_path, 3600);
    if (!error && data?.signedUrl) profile.avatar_url = data.signedUrl;
  }
  res.json({ user: profile });
}));
app.patch('/api/me/profile', requireUser, asyncRoute(async (req, res) => {
  const full_name = String(req.body.full_name || '').trim().slice(0, 120);
  const username = String(req.body.username || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim().slice(0, 40);
  const city = String(req.body.city || '').trim().slice(0, 100);
  const about = String(req.body.about || '').trim().slice(0, 1000);
  if (!full_name) return res.status(400).json({ error: 'Укажите имя для профиля' });
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({ error: 'Юзернейм: 3–24 символа, латинские буквы, цифры и _' });
  }
  const preferences = { ...(req.user.preferences || {}), about };
  const { data, error } = await supabase.from('users')
    .update({ full_name, username, phone: phone || null, city: city || null, preferences })
    .eq('id', req.user.id)
    .select('id,email,full_name,username,phone,city,avatar_url,avatar_path,preferences')
    .single();
  if (error?.code === '23505') return res.status(409).json({ error: 'Этот юзернейм уже занят' });
  if (error) return res.status(500).json({ error: 'Не удалось сохранить профиль' });
  const profile = { ...data };
  delete profile.avatar_path;
  if (data.avatar_path) {
    const { data: signed, error: signedError } = await supabase.storage.from('avatars').createSignedUrl(data.avatar_path, 3600);
    if (!signedError && signed?.signedUrl) profile.avatar_url = signed.signedUrl;
  }
  res.json({ user: profile });
}));
let avatarBucketPromise;
async function ensureAvatarBucket() {
  if (!avatarBucketPromise) avatarBucketPromise = (async () => {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    if (buckets.some((bucket) => bucket.name === 'avatars')) return;
    const { error: createError } = await supabase.storage.createBucket('avatars', {
      public: false,
      fileSizeLimit: 2097152,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
    });
    if (createError && !/already exists/i.test(createError.message || '')) throw createError;
  })();
  return avatarBucketPromise;
}
app.post('/api/me/avatar', requireUser, asyncRoute(async (req, res) => {
  const contentType = String(req.body.contentType || '');
  const base64 = String(req.body.imageData || '');
  const formats = {
    'image/jpeg': { ext: 'jpg', valid: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    'image/png': { ext: 'png', valid: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
    'image/webp': { ext: 'webp', valid: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
  };
  const format = formats[contentType];
  if (!format || !base64 || base64.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return res.status(400).json({ error: 'Загрузи изображение JPG, PNG или WebP до 2 МБ' });
  }
  const image = Buffer.from(base64, 'base64');
  if (image.length > 2097152 || !format.valid(image)) {
    return res.status(400).json({ error: 'Файл не похож на корректное изображение до 2 МБ' });
  }
  await ensureAvatarBucket();
  const path = req.user.id + '/' + randomUUID() + '.' + format.ext;
  const { data: uploaded, error: uploadError } = await supabase.storage.from('avatars')
    .upload(path, image, { contentType, cacheControl: '3600', upsert: false });
  if (uploadError) return res.status(500).json({ error: 'Не удалось загрузить аватар' });
  const { data, error } = await supabase.from('users').update({ avatar_path: uploaded.path, avatar_url: null })
    .eq('id', req.user.id).select('avatar_path').single();
  if (error) {
    await supabase.storage.from('avatars').remove([uploaded.path]);
    return res.status(500).json({ error: 'Не удалось сохранить аватар профиля' });
  }
  if (req.user.avatar_path) await supabase.storage.from('avatars').remove([req.user.avatar_path]);
  const { data: signed, error: signedError } = await supabase.storage.from('avatars').createSignedUrl(data.avatar_path, 3600);
  if (signedError) return res.status(500).json({ error: 'Аватар сохранён, но не удалось открыть изображение' });
  res.json({ avatar_url: signed.signedUrl });
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
  const safeReason=String(reason||'').trim().slice(0,200);
  const safeDetails=String(details||'').trim().slice(0,4000);
  if (!safeReason || !safeDetails) return res.status(400).json({ error: 'Укажите причину и подробности' });
  const allowedTargets=['event','user','review','ticket'];
  const normalizedTarget=allowedTargets.includes(targetType)?targetType:'event';
  const { data, error } = await supabase.from('complaints').insert({
    author_id: req.user.id, target_type: normalizedTarget,
    target_id: targetId || null, reason: safeReason,
    details: safeDetails, status: 'new'
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось отправить жалобу' });
  let targetLabel=normalizedTarget==='event'?'мероприятию':'объекту';
  if(normalizedTarget==='event'&&targetId){
    const {data:event}=await supabase.from('events').select('title').eq('id',targetId).maybeSingle();
    if(event?.title)targetLabel='мероприятию «'+String(event.title).slice(0,180)+'»';
  }
  await notifyRootAdmin('Поступила новая жалоба',(req.user.full_name||'Пользователь')+' отправил жалобу на '+targetLabel+'. Причина: '+safeReason,'complaint_received','/admin/');
  res.status(201).json({ complaint: data });
}));
app.get('/api/notifications/unread-count', requireUser, asyncRoute(async(req,res)=>{
  const {count,error}=await supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',req.user.id).eq('is_read',false);
  if(error)return res.status(500).json({error:'Не удалось загрузить счётчик уведомлений'});
  res.json({count:Number(count)||0});
}));
app.patch('/api/notifications/read-all', requireUser, asyncRoute(async(req,res)=>{
  const {error}=await supabase.from('notifications').update({is_read:true}).eq('user_id',req.user.id).eq('is_read',false);
  if(error)return res.status(400).json({error:'Не удалось отметить уведомления прочитанными'});
  res.json({updated:true});
}));
app.get('/api/notifications', requireUser, asyncRoute(async (req, res) => {
  const offset=Math.max(0,parseInt(req.query.offset||'0',10)||0);
  const limit=Math.max(1,Math.min(5,parseInt(req.query.limit||'5',10)||5));
  const { data, error } = await supabase.from('notifications').select('*')
    .eq('user_id', req.user.id).order('created_at', { ascending: false })
    .range(offset,offset+limit);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить уведомления' });
  const rows=data||[];
  res.json({ notifications: rows.slice(0,limit), hasMore: rows.length>limit, offset });
}));
app.patch('/api/notifications/:id/read', requireUser, asyncRoute(async (req, res) => {
  const { error } = await supabase.from('notifications').update({ is_read: true })
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(400).json({ error: 'Не удалось отметить уведомление' });
  res.json({ success: true });
}));

app.post('/api/uploads/event-cover', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const dataUrl = String(req.body.dataUrl || '');
  const match = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+\/]+={0,2})$/.exec(dataUrl);
  if (!match) return res.status(400).json({ error: 'Выберите изображение PNG, JPG или WebP' });
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'Обложка после сжатия должна быть не больше 2 МБ' });
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];
  const path = req.user.id + '/' + randomUUID() + '.' + extension;
  const { error } = await supabase.storage.from('event-covers').upload(path, buffer, {
    contentType, cacheControl: '31536000', upsert: false
  });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить обложку в хранилище' });
  const { data } = supabase.storage.from('event-covers').getPublicUrl(path);
  res.status(201).json({ url: data.publicUrl });
}));
app.post('/api/events', requireUser, allowRoles('organizer', 'admin'), asyncRoute(async (req, res) => {
  const { title, description, category_id, venue_id, hall_id, start_date, start_time, end_time, age_limit, total_seats, base_price, cover_image, location_address, rules, contact_email, contact_phone } = req.body;
  const rawProgram = Array.isArray(req.body.program) ? req.body.program : [];
  if (!title || !start_date || !start_time || !end_time || !Number.isInteger(Number(total_seats)) || Number(total_seats) < 1) {
    return res.status(400).json({ error: 'Заполните название, даты, время и вместимость' });
  }
  if (rawProgram.length > 100) return res.status(400).json({ error: 'В программу можно добавить не более 100 пунктов' });
  const program = rawProgram.map((item) => ({
    client_key: String(item?.client_key || '').trim().slice(0, 80),
    parent_key: String(item?.parent_key || '').trim().slice(0, 80) || null,
    item_type: item?.item_type === 'section' ? 'section' : 'activity',
    title: String(item?.title || '').trim().slice(0, 180),
    start_time: String(item?.start_time || '').trim(),
    end_time: String(item?.end_time || '').trim(),
    duration_minutes: Number(item?.duration_minutes),
    speaker_name: String(item?.speaker_name || '').trim().slice(0, 160),
    room_name: String(item?.room_name || '').trim().slice(0, 120),
    max_attendees: Number(item?.max_attendees),
    description: String(item?.description || '').trim().slice(0, 2000)
  }));
  const completeProgram = program.filter((item) => item.title || item.start_time || item.end_time);
  const programKeys = new Set();
  for (const item of completeProgram) {
    if (!item.client_key || programKeys.has(item.client_key)) return res.status(400).json({ error: 'В программе обнаружены повторяющиеся или пустые ключи элементов' });
    programKeys.add(item.client_key);
    if (!item.title || !/^\\d{2}:\\d{2}$/.test(item.start_time) || !/^\\d{2}:\\d{2}$/.test(item.end_time) ||
        !Number.isInteger(item.duration_minutes) || item.duration_minutes < 1 || item.duration_minutes > 1440 ||
        !Number.isInteger(item.max_attendees) || item.max_attendees < 1) {
      return res.status(400).json({ error: 'Каждому пункту нужны название, время, длительность и положительный лимит участников' });
    }
    const startMinutes = Number(item.start_time.slice(0, 2)) * 60 + Number(item.start_time.slice(3, 5));
    const endMinutes = (startMinutes + item.duration_minutes) % 1440;
    const expectedEnd = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' + String(endMinutes % 60).padStart(2, '0');
    if (expectedEnd !== item.end_time) return res.status(400).json({ error: 'Время окончания должно соответствовать длительности пункта' });
  }
  let eventAddress = String(location_address || '').trim().slice(0, 500);
  if (venue_id) {
    const { data: venue, error: venueError } = await supabase.from('venues').select('id,address,owner_id').eq('id', venue_id).maybeSingle();
    if (venueError || !venue || (venue.owner_id && venue.owner_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(400).json({ error: 'Выберите свою площадку или укажите адрес вручную' });
    }
    if (!eventAddress) eventAddress = String(venue.address || '').trim();
  }
  if (!eventAddress) return res.status(400).json({ error: 'Укажите адрес мероприятия или выберите площадку с адресом' });
  if (hall_id) {
    const { data: hall } = await supabase.from('halls').select('id,venue_id,total_capacity').eq('id', hall_id).maybeSingle();
    if (!hall || String(hall.venue_id) !== String(venue_id) || Number(total_seats) > Number(hall.total_capacity)) {
      return res.status(400).json({ error: 'Выберите зал этой площадки и не превышайте его вместимость' });
    }
    const { error: seatError } = await supabase.rpc('ensure_hall_seats', { p_hall_id: hall.id });
    if (seatError) return res.status(500).json({ error: 'Не удалось подготовить места в зале' });
  }
  const dynamicPricingEnabled = req.body.dynamic_pricing_enabled !== false;
  const { data, error } = await supabase.from('events').insert({
    organizer_id: req.user.id, title: String(title).trim().slice(0, 180),
    description: String(description || '').slice(0, 10000),
    category_id: category_id || null, venue_id: venue_id || null, hall_id: hall_id || null,
    location_address: eventAddress,
    start_date, start_time, end_time, age_limit: age_limit || 'Для всех',
    total_seats: Number(total_seats), available_seats: Number(total_seats),
    base_price: Number(base_price || 0), current_price: Number(base_price || 0), dynamic_pricing_enabled: dynamicPricingEnabled,
    cover_image: cover_image || null, rules: String(rules || '').trim().slice(0, 5000),
    contact_email: String(contact_email || '').trim().slice(0, 254) || null,
    contact_phone: String(contact_phone || '').trim().slice(0, 40) || null,
    status: 'pending_moderation'
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось создать мероприятие' });
  const insertedProgram = [];
  const idsByKey = new Map();
  const typesByKey = new Map();
  for (const item of completeProgram) {
    const parentId = item.parent_key ? idsByKey.get(item.parent_key) : null;
    if (item.parent_key && !parentId) {
      await supabase.from('events').delete().eq('id', data.id).eq('organizer_id', req.user.id);
      return res.status(400).json({ error: 'Сначала создайте секцию перед вложенными элементами' });
    }
    if (item.parent_key && typesByKey.get(item.parent_key) !== 'section') {
      await supabase.from('events').delete().eq('id', data.id).eq('organizer_id', req.user.id);
      return res.status(400).json({ error: 'Вложить пункт можно только в секцию' });
    }
    if (item.item_type === 'section' && item.parent_key) {
      await supabase.from('events').delete().eq('id', data.id).eq('organizer_id', req.user.id);
      return res.status(400).json({ error: 'Секции размещаются на верхнем уровне программы' });
    }
    const { client_key, parent_key, ...values } = item;
    const { data: savedItem, error: programError } = await supabase.from('event_program').insert({
      ...values, event_id: data.id, parent_section_id: parentId
    }).select('*').single();
    if (programError) {
      await supabase.from('events').delete().eq('id', data.id).eq('organizer_id', req.user.id);
      console.error('[events] program insert failed:', programError.message);
      return res.status(400).json({ error: 'Не удалось сохранить программу. Мероприятие отменено.' });
    }
    insertedProgram.push(savedItem);
    idsByKey.set(client_key, savedItem.id);
    typesByKey.set(client_key, item.item_type);
  }
  res.status(201).json({ event: data, program: insertedProgram });
}));
app.get('/api/organizer/events', requireUser, allowRoles('organizer', 'admin'), asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('events').select('*,venues(name,city,address),event_categories(name),event_program(*)')
    .eq('organizer_id', req.user.id).neq('status', 'cancelled').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить мероприятия организатора' });
  res.json({ events: data });
}));
app.patch('/api/events/:id', requireUser, allowRoles('organizer', 'admin'), asyncRoute(async (req, res) => {
  const changes = {};
  for (const key of ['title','description','category_id','venue_id','hall_id','start_date','start_time','end_time','age_limit','total_seats','base_price','cover_image','rules']) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  if (req.body.location_address !== undefined) changes.location_address = String(req.body.location_address || '').trim().slice(0, 500);
  if (req.body.description !== undefined) changes.description = String(req.body.description || '').slice(0, 10000);
  if (req.body.contact_email !== undefined) changes.contact_email = String(req.body.contact_email || '').trim().slice(0, 254) || null;
  if (req.body.contact_phone !== undefined) changes.contact_phone = String(req.body.contact_phone || '').trim().slice(0, 40) || null;
  if (req.body.rules !== undefined) changes.rules = String(req.body.rules || '').trim().slice(0, 5000);
  if (req.body.dynamic_pricing_enabled !== undefined) changes.dynamic_pricing_enabled = req.body.dynamic_pricing_enabled === true;
  if (req.body.hall_id !== undefined) {
    const hallId = req.body.hall_id || null;
    if (hallId) {
      const { data: hall } = await supabase.from('halls').select('id,venue_id,total_capacity').eq('id', hallId).maybeSingle();
      const { data: current } = await supabase.from('events').select('venue_id,total_seats').eq('id', req.params.id).eq('organizer_id', req.user.id).maybeSingle();
      const venueId = changes.venue_id !== undefined ? changes.venue_id : current?.venue_id;
      const capacity = changes.total_seats !== undefined ? Number(changes.total_seats) : Number(current?.total_seats || 0);
      if (!hall || String(hall.venue_id) !== String(venueId) || capacity > Number(hall.total_capacity)) {
        return res.status(400).json({ error: 'Выберите зал этой площадки и не превышайте его вместимость' });
      }
      const { error: seatError } = await supabase.rpc('ensure_hall_seats', { p_hall_id: hall.id });
      if (seatError) return res.status(500).json({ error: 'Не удалось подготовить места в зале' });
    }
    changes.hall_id = hallId;
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
app.patch('/api/admin/users/:id/block', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const { data: target, error: lookupError } = await supabase.from('users').select('id,email,full_name').eq('id', req.params.id).maybeSingle();
  if (lookupError) return res.status(500).json({ error: 'Не удалось найти аккаунт' });
  if (!target) return res.status(404).json({ error: 'Аккаунт не найден' });
  if (isRootEmail(target.email)) return res.status(409).json({ error: 'Главный администратор не может быть заблокирован' });
  const blocked = req.body.blocked === true;
  const authTarget = await supabase.auth.admin.getUserById(target.id);
  if (authTarget.error || !authTarget.data?.user) return res.status(500).json({ error: 'Не удалось проверить права аккаунта' });
  const oldMeta = authTarget.data.user.app_metadata || {};
  const claimWrite = await supabase.auth.admin.updateUserById(target.id, {
    app_metadata: { ...oldMeta, flowtix_role: validRoles.has(oldMeta.flowtix_role) ? oldMeta.flowtix_role : 'visitor', flowtix_blocked: blocked }
  });
  if (claimWrite.error) return res.status(500).json({ error: 'Не удалось защитить изменение блокировки' });
  const { data, error } = await supabase.from('users').update({ is_blocked: blocked })
    .eq('id', target.id).select('id,email,is_blocked').single();
  if (error) return res.status(400).json({ error: 'Защищённый статус изменён, но профиль не синхронизирован' });
  await supabase.from('audit_logs').insert({ actor_id: req.user.id, actor_name: req.user.full_name, action: blocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED', entity_type: 'user', entity_id: target.id, details: { email: target.email } });
  await createNotification(target.id,blocked?'Аккаунт заблокирован':'Аккаунт разблокирован',blocked?'Администратор ограничил доступ к аккаунту.':'Доступ к аккаунту восстановлен.','account_access');
  res.json({ user: data });
}));
app.patch('/api/admin/users/:id/role', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const role = String(req.body.role || '');
  if (!['visitor','organizer','staff','moderator'].includes(role)) return res.status(400).json({ error: 'Допустимые роли: посетитель, организатор, сотрудник и модератор' });
  const { data: target, error: lookupError } = await supabase.from('users').select('id,email,full_name,role').eq('id', req.params.id).maybeSingle();
  if (lookupError) return res.status(500).json({ error: 'Не удалось найти аккаунт' });
  if (!target) return res.status(404).json({ error: 'Аккаунт не найден' });
  if (isRootEmail(target.email)) return res.status(409).json({ error: 'Единственный главный администратор не может быть переназначен' });
  const authTarget = await supabase.auth.admin.getUserById(target.id);
  if (authTarget.error || !authTarget.data?.user) return res.status(500).json({ error: 'Не удалось проверить права аккаунта' });
  const oldMeta = authTarget.data.user.app_metadata || {};
  const newMeta = { ...oldMeta, flowtix_role: role, flowtix_blocked: oldMeta.flowtix_blocked === true };
  const claimWrite = await supabase.auth.admin.updateUserById(target.id, { app_metadata: newMeta });
  if (claimWrite.error) return res.status(500).json({ error: 'Не удалось сохранить защищённую роль' });
  const { data, error } = await supabase.from('users').update({ role })
    .eq('id', target.id).select('id,email,full_name,role').single();
  if (error) {
    await supabase.auth.admin.updateUserById(target.id, { app_metadata: oldMeta });
    return res.status(400).json({ error: 'Не удалось сохранить роль' });
  }
  if (role === 'staff') {
    const { data: employee } = await supabase.from('employees').select('id').eq('user_id', data.id).maybeSingle();
    if (!employee) await supabase.from('employees').insert({ user_id: data.id, position: 'Сотрудник мероприятия' });
  }
  await supabase.from('audit_logs').insert({ actor_id: req.user.id, actor_name: req.user.full_name, action: 'USER_ROLE_CHANGED', entity_type: 'user', entity_id: target.id, details: { role } });
  const roleNames={visitor:'Посетитель',organizer:'Организатор',staff:'Сотрудник мероприятия',moderator:'Модератор'};
  await createNotification(target.id,'Роль аккаунта изменена','Теперь ваша роль: '+roleNames[role]+'.','account_role');
  res.json({ user: data });
}));

app.get('/api/events/:id/seats', requireUser, asyncRoute(async (req, res) => {
  const { data: event, error: eventError } = await supabase.from('events')
    .select('id,hall_id,total_seats,available_seats,halls(id,name,total_capacity,layout_config)')
    .eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (eventError) return res.status(500).json({ error: 'Не удалось загрузить схему мест' });
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const { data: ensuredHallId, error: hallError } = await supabase.rpc('ensure_event_seat_hall', { p_event_id: event.id });
  if (hallError) return res.status(500).json({ error: 'Не удалось создать схему мест' });
  const hallId = ensuredHallId || event.hall_id;
  if (!hallId) return res.json({ seatSelectionRequired: false, reason: 'capacity_limit', seats: [], event });
  const { error: ensureError } = await supabase.rpc('ensure_hall_seats', { p_hall_id: hallId });
  if (ensureError) return res.status(500).json({ error: 'Не удалось подготовить схему мест' });
  const [seatResult, reservationResult, ticketResult] = await Promise.all([
    supabase.from('seats').select('id,row_label,seat_number,seat_type,price_multiplier')
      .eq('hall_id', hallId).order('row_label').order('seat_number').limit(2000),
    supabase.from('seat_reservations').select('seat_id,user_id,reserved_until')
      .eq('event_id', event.id).eq('status', 'reserved').gt('reserved_until', new Date().toISOString()),
    supabase.from('tickets').select('seat_id').eq('event_id', event.id).in('status', ['valid', 'used']).not('seat_id', 'is', null)
  ]);
  if (seatResult.error || reservationResult.error || ticketResult.error) {
    return res.status(500).json({ error: 'Не удалось загрузить доступность мест' });
  }
  const capacity = Math.min(Number(event.total_seats || seatResult.data.length), seatResult.data.length);
  const reservations = new Map((reservationResult.data || []).map(item => [item.seat_id, item]));
  const occupied = new Set((ticketResult.data || []).map(item => item.seat_id));
  const seats = seatResult.data.slice(0, capacity).map(seat => {
    const hold = reservations.get(seat.id);
    const status = occupied.has(seat.id) ? 'occupied'
      : hold ? (hold.user_id === req.user.id ? 'mine' : 'reserved') : 'available';
    return { ...seat, status, reserved_until: hold?.user_id === req.user.id ? hold.reserved_until : null };
  });
  res.json({ seatSelectionRequired: true, event, seats });
}));


app.get('/api/payments/config', requireUser, asyncRoute(async (_req,res) => {
  const {data:setting}=await supabase.from('platform_settings').select('value').eq('key','visual_payments_enabled').maybeSingle();
  res.json({available:paymentProviderReady,provider:paymentProviderReady?paymentProviderName:null,currency:'KZT',visualPaymentsEnabled:setting?.value===true});
}));

app.post('/api/payments/checkout', requireUser, asyncRoute(async (req,res) => {
  if(!paymentProviderReady)return res.status(503).json({error:'Касса пока не подключена. Вы можете оплатить с баланса.'});
  const eventId=String(req.body.eventId||'');
  const seatId=req.body.seatId?String(req.body.seatId):null;
  const idempotencyKey=String(req.get('Idempotency-Key')||req.body.idempotencyKey||'');
  if(!eventId||idempotencyKey.length<12)return res.status(400).json({error:'Не удалось подготовить платёж'});
  const {data:intent,error}=await supabase.rpc('create_payment_intent',{p_user_id:req.user.id,p_event_id:eventId,p_seat_id:seatId,p_idempotency_key:idempotencyKey,p_provider:paymentProviderName});
  if(error)return res.status(error.message.includes('sold_out')?409:400).json({error:error.message.includes('sold_out')?'Мест больше нет':error.message.includes('insufficient')?'Недостаточно средств':error.message.includes('already_registered')?'Вы уже зарегистрированы':'Не удалось зарезервировать место для оплаты'});
  if(intent.checkout_url&&intent.provider_reference)return res.json({intentId:intent.id,checkoutUrl:intent.checkout_url,expiresAt:intent.expires_at});
  const merchantReference=String(intent.id);
  try{
    const response=await fetch(paymentCreateUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+paymentApiKey,'Idempotency-Key':idempotencyKey},body:JSON.stringify({merchant_reference:merchantReference,amount:Number(intent.amount),currency:intent.currency||'KZT',description:'Билет FlowTix',expires_at:intent.expires_at,return_url:publicSiteUrl+'/?paymentIntent='+encodeURIComponent(merchantReference),webhook_url:paymentWebhookUrl}),signal:AbortSignal.timeout(15000)});
    const providerResult=await response.json().catch(()=>({}));
    const checkoutUrl=String(providerResult.checkout_url||providerResult.checkoutUrl||'');
    const providerReference=String(providerResult.provider_reference||providerResult.id||'');
    let safeUrl;try{safeUrl=new URL(checkoutUrl)}catch{}
    if(!response.ok||!safeUrl||safeUrl.protocol!=='https:'||!providerReference)throw new Error('provider_checkout_failed');
    const {error:updateError}=await supabase.rpc('update_payment_checkout',{p_intent_id:intent.id,p_provider_reference:providerReference,p_checkout_url:safeUrl.toString()});
    if(updateError)throw updateError;
    res.status(201).json({intentId:intent.id,checkoutUrl:safeUrl.toString(),expiresAt:intent.expires_at});
  }catch(error){
    await supabase.rpc('cancel_payment_intent',{p_intent_id:intent.id,p_status:'failed'});
    console.error('[payments] checkout initialization failed:',error.message);
    res.status(502).json({error:'Касса не смогла создать платёж. Бронь места снята.'});
  }
}));

app.get('/api/payments/intents/:id', requireUser, asyncRoute(async(req,res)=>{
  const {data,error}=await supabase.rpc('get_payment_intent',{p_intent_id:req.params.id,p_user_id:req.user.id});
  if(error||!data)return res.status(404).json({error:'Платёж не найден'});
  if(data.status==='pending'&&new Date(data.expiresAt).getTime()<=Date.now()){
    await supabase.rpc('cancel_payment_intent',{p_intent_id:req.params.id,p_status:'expired'});
    return res.json({...data,status:'expired'});
  }
  res.json(data);
}));

app.post('/api/webhooks/payments', asyncRoute(async(req,res)=>{
  if(!paymentWebhookSecret)return res.status(503).json({error:'Проверка кассы не настроена'});
  const supplied=String(req.get('X-FlowTix-Signature')||'').replace(/^sha256=/i,'').trim();
  const expected=createHmac('sha256',paymentWebhookSecret).update(req.rawBody||Buffer.alloc(0)).digest();
  let received;try{received=Buffer.from(supplied,'hex')}catch{return res.sendStatus(401)}
  if(received.length!==expected.length||!timingSafeEqual(received,expected))return res.sendStatus(401);
  const payload=req.body||{};
  const intentId=String(payload.merchant_reference||payload.reference||'');
  const providerReference=String(payload.provider_reference||'');
  if(!intentId)return res.status(400).json({error:'Не указан идентификатор платежа'});
  if(payload.status==='paid'||payload.status==='completed'){
    const {data:previous}=await supabase.from('payment_intents').select('status,provider_reference,amount,currency,ticket_id').eq('id',intentId).maybeSingle();
    if(previous?.status==='paid'){
      const same=previous.provider_reference===providerReference&&Number(previous.amount)===Number(payload.amount)&&String(previous.currency).toUpperCase()===String(payload.currency||'').toUpperCase();
      return same?res.json({received:true,duplicate:true}):res.status(409).json({error:'Платёж не прошёл проверку'});
    }
    const {data,error}=await supabase.rpc('settle_payment_intent',{p_intent_id:intentId,p_provider_reference:providerReference,p_amount:Number(payload.amount),p_currency:String(payload.currency||'')});
    if(error)return res.status(409).json({error:'Платёж не прошёл проверку'});
    return res.json({received:true,ticket:data?.ticket?.ticket_number||null});
  }
  if(payload.status==='failed'||payload.status==='cancelled'){
    await supabase.rpc('cancel_payment_intent',{p_intent_id:intentId,p_status:'failed'});
    return res.json({received:true});
  }
  res.status(400).json({error:'Неизвестный статус платежа'});
}));

app.get('/api/events/:id/queue',requireUser,asyncRoute(async(req,res)=>{
 const {data,error}=await supabase.rpc('get_event_queue_status',{p_user_id:req.user.id,p_event_id:req.params.id});
 if(error)return res.status(400).json({error:error.message.includes('event_unavailable')?'Мероприятие недоступно':'Не удалось загрузить очередь'});
 res.json(data);
}));
app.post('/api/events/:id/queue',requireUser,asyncRoute(async(req,res)=>{
 const {data,error}=await supabase.rpc('join_event_queue',{p_user_id:req.user.id,p_event_id:req.params.id});
 if(error)return res.status(error.message.includes('event_unavailable')?404:400).json({error:error.message.includes('event_unavailable')?'Мероприятие недоступно':'Не удалось встать в очередь'});
 res.status(data.joined?201:200).json(data);
}));
app.delete('/api/events/:id/queue',requireUser,asyncRoute(async(req,res)=>{
 const {data,error}=await supabase.rpc('leave_event_queue',{p_user_id:req.user.id,p_event_id:req.params.id});
 if(error)return res.status(400).json({error:'Не удалось выйти из очереди'});
 res.json({cancelled:Boolean(data)});
}));

app.post('/api/seat-reservations', requireUser, asyncRoute(async (req, res) => {
  const eventId = String(req.body.eventId || '');
  const seatId = String(req.body.seatId || '');
  if (!eventId || !seatId) return res.status(400).json({ error: 'Выберите место' });
  const { data, error } = await supabase.rpc('reserve_event_seat', {
    p_user_id: req.user.id, p_event_id: eventId, p_seat_id: seatId
  });
  if (error) {
    const reason = error.message || '';
    const status = reason.includes('sold_out') || reason.includes('seat_unavailable') ? 409 : 400;
    const message = reason.includes('sold_out') ? 'Свободных мест больше нет'
      : reason.includes('seat_unavailable') ? 'Это место уже выбрали. Обновил схему — выберите другое.'
      : 'Не удалось временно забронировать место';
    return res.status(status).json({ error: message });
  }
  res.status(201).json({ reservation: data });
}));

app.post('/api/seat-reservations/release', requireUser, asyncRoute(async (req, res) => {
  const { eventId, seatId } = req.body || {};
  const { data, error } = await supabase.rpc('release_event_seat', {
    p_user_id: req.user.id, p_event_id: String(eventId || ''), p_seat_id: String(seatId || '')
  });
  if (error) return res.status(400).json({ error: 'Не удалось отменить бронь места' });
  res.json({ released: Boolean(data) });
}));

app.post('/api/registrations', requireUser, asyncRoute(async (req, res) => {
  const eventId = String(req.body.eventId || '');
  const promoCode = String(req.body.promoCode || '').trim().toUpperCase().slice(0, 32);
  const { data, error } = await supabase.rpc('wallet_register_for_event_with_promo', {
    p_user_id: req.user.id, p_event_id: eventId, p_seat_id: req.body.seatId || null, p_promo_code: promoCode || null
  });
  if (error) {
    const reason = error.message || '';
    const status = reason.includes('payment_provider_required') ? 501
      : reason.includes('already_registered') ? 409
      : reason.includes('sold_out') || reason.includes('seat_unavailable') ? 409 : 400;
    const promoError = reason.includes('promo_invalid') ? 'Промокод не найден или отключён' : reason.includes('promo_expired') ? 'Срок действия промокода истёк' : reason.includes('promo_limit_reached') ? 'Лимит использований промокода исчерпан' : reason.includes('promo_wrong_event') ? 'Промокод действует на другое мероприятие' : reason.includes('promo_wrong_category') ? 'Промокод действует на другую категорию' : reason.includes('promo_minimum_not_met') ? 'Не достигнута минимальная сумма для промокода' : reason.includes('promo_new_users_only') ? 'Промокод доступен только новым пользователям' : reason.includes('promo_wrong_ticket_type') ? 'Промокод не действует на выбранный тип билета' : '';
    const message = promoError || (reason.includes('insufficient_balance') ? 'Недостаточно средств на балансе. Откройте «Баланс» в меню аккаунта и пополните его.' : reason.includes('payment_provider_required') ? 'Оплата пока недоступна: платёжный провайдер не подключён. Платные регистрации закрыты.'
      : reason.includes('already_registered') ? 'Вы уже зарегистрированы'
      : reason.includes('sold_out') ? 'Свободных мест больше нет' : reason.includes('seat_required') ? 'Выберите место на схеме зала' : reason.includes('seat_unavailable') ? 'Выбранное место уже заняли. Выберите другое.' : reason.includes('reservation_expired') ? 'Время брони истекло. Выберите место ещё раз.' : 'Не удалось зарегистрироваться');
    return res.status(status).json({ error: message });
  }
  await supabase.from('audit_logs').insert({
    actor_id: req.user.id, actor_name: req.user.full_name,
    action: 'REGISTER_FOR_EVENT', entity_type: 'ticket',
    entity_id: data.ticket.id, details: { event_id: eventId, payment_method: 'wallet', amount: data.ticket.price_paid }
  });
  const {data:eventNotice}=await supabase.from('events').select('title,organizer_id').eq('id',eventId).maybeSingle();
  if(eventNotice?.organizer_id&&eventNotice.organizer_id!==req.user.id)await createNotification(eventNotice.organizer_id,'Новый участник мероприятия',(req.user.full_name||'Пользователь')+' зарегистрировался на «'+(eventNotice.title||'ваше мероприятие')+'».','event_registration');
  res.status(201).json(data);
}));
app.get('/api/tickets/mine', requireUser, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('tickets')
    .select('*,events(id,title,start_date,start_time,end_time,location_address,event_categories(name),venues(name,city,address))')
    .eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) { console.error('[tickets/mine] query failed:', error.message); return res.status(500).json({ error: 'Не удалось загрузить билеты' }); }
  const nowParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const nowFields = Object.fromEntries(nowParts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const localNow = nowFields.year+'-'+nowFields.month+'-'+nowFields.day+'T'+nowFields.hour+':'+nowFields.minute+':'+nowFields.second;
  const tickets = (data || []).map(ticket => {
    const event = ticket.events;
    const eventEnd = event?.start_date
      ? String(event.start_date).slice(0,10)+'T'+String(event.end_time || event.start_time || '23:59:59').slice(0,8)
      : '';
    return { ...ticket, is_expired: Boolean(eventEnd && eventEnd < localNow) };
  });
  res.json({ tickets });
}));
app.get('/api/reviews/mine', requireUser, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('reviews')
    .select('id,event_id,overall_rating,comment,created_at,events(id,title,start_date)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить ваши отзывы' });
  res.json({ reviews: data || [] });
}));
app.post('/api/reviews', requireUser, asyncRoute(async (req, res) => {
  const eventId = String(req.body.eventId || '');
  const rating = Number(req.body.rating);
  const comment = String(req.body.comment || '').trim();
  if (!eventId || !Number.isInteger(rating) || rating < 1 || rating > 5 || !comment || comment.length > 1000) {
    return res.status(400).json({ error: 'Выберите оценку от 1 до 5 звёзд и напишите комментарий (до 1000 символов)' });
  }
  const { count, error: ticketError } = await supabase.from('tickets').select('id', { count: 'exact', head: true })
    .eq('event_id', eventId).eq('user_id', req.user.id).in('status', ['valid', 'used']);
  if (ticketError) return res.status(500).json({ error: 'Не удалось проверить участие в мероприятии' });
  if (!count) return res.status(403).json({ error: 'Оставлять отзыв могут только участники с билетом' });
  const { data: prior, error: priorError } = await supabase.from('reviews').select('id')
    .eq('event_id', eventId).eq('user_id', req.user.id).maybeSingle();
  if (priorError) return res.status(500).json({ error: 'Не удалось проверить предыдущий отзыв' });
  if (prior) return res.status(409).json({ error: 'Вы уже оставили отзыв на это событие' });
  const { data, error } = await supabase.from('reviews').insert({
    event_id: eventId, user_id: req.user.id,
    org_rating: rating, venue_rating: rating, program_rating: rating, staff_rating: rating,
    overall_rating: rating, comment
  }).select('id,event_id,overall_rating,comment,created_at').single();
  if (error) return res.status(400).json({ error: 'Не удалось сохранить отзыв' });
  const {data:eventNotice}=await supabase.from('events').select('title,organizer_id').eq('id',eventId).maybeSingle();
  if(eventNotice?.organizer_id&&eventNotice.organizer_id!==req.user.id)await createNotification(eventNotice.organizer_id,'Новый отзыв',(req.user.full_name||'Участник')+' оставил отзыв на «'+(eventNotice.title||'мероприятие')+'».','event_review');
  res.status(201).json({ review: data });
}));
app.get('/api/organizer/registrations', requireUser, allowRoles('organizer', 'admin'), asyncRoute(async (req, res) => {
  const { data: events, error: eventsError } = await supabase.from('events').select('id').eq('organizer_id', req.user.id);
  if (eventsError) return res.status(500).json({ error: 'Не удалось загрузить мероприятия' });
  const ids = (events || []).map((event) => event.id);
  if (!ids.length) return res.json({ registrations: [] });
  const { data, error } = await supabase.from('tickets')
    .select('ticket_number,status,seat_label,price_paid,created_at,events(id,title),users!tickets_user_id_fkey(full_name,email)')
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
app.get('/api/staff/events/:eventId/participants', requireUser, allowRoles('staff','admin'), asyncRoute(async (req, res) => {
  if (req.user.role === 'staff') {
    const { data: employee } = await supabase.from('employees').select('id').eq('user_id', req.user.id).maybeSingle();
    if (!employee) return res.status(403).json({ error: 'Сотрудник не найден' });
    const { data: assignment } = await supabase.from('event_staff_assignments').select('id')
      .eq('event_id', req.params.eventId).eq('employee_id', employee.id).eq('status', 'assigned').maybeSingle();
    if (!assignment) return res.status(403).json({ error: 'Вы не назначены на это мероприятие' });
  }
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const { data, error, count } = await supabase.from('tickets')
    .select('id,ticket_number,status,seat_label,created_at,users!tickets_user_id_fkey(full_name,email)', { count: 'exact' })
    .eq('event_id', req.params.eventId).in('status', ['valid','used'])
    .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + 4);
  if (error) {
    console.error('[staff/participants] query failed:', error.message);
    return res.status(500).json({ error: 'Не удалось загрузить список участников' });
  }
  const participants = data || [];
  res.json({ participants, total: count || 0, hasMore: offset + participants.length < (count || 0) });
}));
app.post('/api/staff/tickets/:ticketNumber/check-in', requireUser, allowRoles('staff', 'admin'), asyncRoute(async (req, res) => {
  const ticketNumber = String(req.params.ticketNumber || '').trim().toUpperCase();
  const eventId = String(req.body.eventId || '');
  if (!ticketNumber || ticketNumber.length > 40 || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    return res.status(400).json({ error: 'Выберите мероприятие и укажите корректный билет' });
  }
  const { data, error } = await supabase.rpc('staff_check_in_ticket', {
    p_ticket_number: ticketNumber,
    p_event_id: eventId,
    p_staff_id: req.user.id,
    p_bypass_assignment: req.user.role === 'admin'
  });
  if (error) {
    const message = error.message || '';
    const status = message.includes('ticket_not_found') ? 404
      : message.includes('staff_assignment_required') ? 403 : 409;
    const errorText = message.includes('wrong_event') ? 'Билет предназначен для другого мероприятия.'
      : message.includes('ticket_already_used') ? 'Билет уже был использован.'
      : message.includes('ticket_expired') ? 'Билет недействителен: время мероприятия истекло.'
      : message.includes('ticket_invalid') ? 'Билет недействителен.'
      : message.includes('staff_assignment_required') ? 'Сотрудник не назначен на это мероприятие.'
      : message.includes('organizer_blocked_user') ? 'Этот участник заблокирован организатором и не может быть допущен на мероприятие.'
      : message.includes('ticket_not_found') ? 'Билет не найден.'
      : 'Не удалось проверить билет.';
    return res.status(status).json({ error: errorText });
  }
  await supabase.from('audit_logs').insert({
    actor_id: req.user.id, actor_name: req.user.full_name, action: 'STAFF_TICKET_CHECKED_IN',
    entity_type: 'ticket', entity_id: data.id, details: { ticket_number: data.ticket_number, event_id: data.event_id }
  });
  res.json({ ticket: data });
}));
async function enrichComplaintTargets(complaints=[]){
 const collect=type=>[...new Set(complaints.filter(c=>c.target_type===type&&c.target_id).map(c=>c.target_id))];
 const [eventIds,userIds,reviewIds,ticketIds]=['event','user','review','ticket'].map(collect);
 const tasks=[
  eventIds.length?supabase.from('events').select('id,title,start_date,start_time,location_address,venues(name,city,address)').in('id',eventIds):Promise.resolve({data:[]}),
  userIds.length?supabase.from('users').select('id,full_name,username,email').in('id',userIds):Promise.resolve({data:[]}),
  reviewIds.length?supabase.from('reviews').select('id,event_id,comment,events(id,title,start_date,start_time)').in('id',reviewIds):Promise.resolve({data:[]}),
  ticketIds.length?supabase.from('tickets').select('id,ticket_number,event_id,events(id,title,start_date,start_time)').in('id',ticketIds):Promise.resolve({data:[]})
 ];
 const results=await Promise.all(tasks);
 const failed=results.find(result=>result.error);if(failed)throw failed.error;
 const [events,users,reviews,tickets]=results.map(result=>new Map((result.data||[]).map(row=>[row.id,row])));
 return complaints.map(complaint=>({...complaint,target:
  complaint.target_type==='event'?events.get(complaint.target_id)||null:
  complaint.target_type==='user'?users.get(complaint.target_id)||null:
  complaint.target_type==='review'?reviews.get(complaint.target_id)||null:
  complaint.target_type==='ticket'?tickets.get(complaint.target_id)||null:null
 }));
}
app.get('/api/moderation/complaints', requireUser, allowRoles('moderator', 'admin'), asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('complaints').select('*,users!complaints_author_id_fkey(id,full_name,email,username)')
    .in('status',['new','in_review']).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить жалобы' });
  try{res.json({ complaints: await enrichComplaintTargets(data||[]) })}
  catch(targetError){console.error('[moderation] complaint targets failed:',targetError.message);res.status(500).json({error:'Не удалось загрузить объект жалобы'})}
}));
app.patch('/api/moderation/complaints/:id', requireUser, allowRoles('moderator', 'admin'), asyncRoute(async (req, res) => {
  const nextStatus=String(req.body.status||'');
  if (!['in_review','resolved','rejected'].includes(nextStatus)) return res.status(400).json({ error: 'Недопустимый статус' });
  const {data:previous,error:lookupError}=await supabase.from('complaints')
    .select('id,author_id,status,reason,target_type,target_id').eq('id',req.params.id).maybeSingle();
  if(lookupError)return res.status(500).json({error:'Не удалось загрузить жалобу'});
  if(!previous)return res.status(404).json({error:'Жалоба не найдена'});
  if(previous.status==='new'&&nextStatus!=='in_review')return res.status(409).json({error:'Сначала возьмите жалобу в работу'});
  if(previous.status!=='new'&&previous.status!=='in_review')return res.status(409).json({error:'Эта жалоба уже закрыта'});
  if(previous.status==='in_review'&&nextStatus==='in_review')return res.status(409).json({error:'Жалоба уже находится в работе'});
  const moderatorNotes=String(req.body.moderatorNotes||'').trim().slice(0,1000);
  const { data, error } = await supabase.from('complaints').update({
    status: nextStatus, moderator_notes: moderatorNotes,
    reviewed_by: req.user.id, updated_at: new Date().toISOString()
  }).eq('id', req.params.id).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось обновить жалобу' });
  const statusLabels={in_review:'взята в работу',resolved:'рассмотрена и одобрена',rejected:'рассмотрена и отклонена'};
  const extra=moderatorNotes?' Комментарий: '+moderatorNotes:'';
  await createNotification(previous.author_id,'Изменён статус жалобы','Ваша жалоба «'+String(previous.reason||'').slice(0,160)+'» '+statusLabels[nextStatus]+'.'+extra,'complaint_status','/notifications/');
  await supabase.from('audit_logs').insert({
    actor_id:req.user.id,actor_name:req.user.full_name,action:'COMPLAINT_STATUS_CHANGED',
    entity_type:'complaint',entity_id:data.id,details:{from:previous.status,to:nextStatus,author_id:previous.author_id,reason:previous.reason,target_type:previous.target_type,target_id:previous.target_id,moderator_notes:moderatorNotes}
  });
  const finalDecision=nextStatus==='resolved'||nextStatus==='rejected';
  if(finalDecision){
    const {data:deleted,error:deleteError}=await supabase.from('complaints').delete().eq('id',data.id).select('id').maybeSingle();
    if(deleteError)return res.status(500).json({error:'Решение сохранено, но карточку жалобы удалить не удалось'});
    if(!deleted)return res.status(404).json({error:'Карточка жалобы уже удалена'});
  }
  res.json({ complaint: data, deleted: finalDecision });
}));
app.get('/api/moderation/users', requireUser, allowRoles('moderator','admin'), asyncRoute(async (_req, res) => {
  const { data: authResult, error: authError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (authError) return res.status(500).json({ error: 'Не удалось загрузить аккаунты' });
  const accounts = (authResult.users || []).filter((account) => !isRootEmail(account.email));
  if (!accounts.length) return res.json({ users: [] });
  const { data: profiles, error } = await supabase.from('users').select('id,full_name').in('id', accounts.map((account) => account.id));
  if (error) return res.status(500).json({ error: 'Не удалось загрузить профили' });
  const names = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
  res.json({ users: accounts.map((account) => ({
    id: account.id, email: account.email, full_name: names.get(account.id) || account.user_metadata?.full_name || '',
    role: validRoles.has(account.app_metadata?.flowtix_role) ? account.app_metadata.flowtix_role : 'visitor',
    is_blocked: account.app_metadata?.flowtix_blocked === true
  })) });
}));
app.patch('/api/moderation/users/:id/block', requireUser, allowRoles('moderator','admin'), asyncRoute(async (req, res) => {
  const { data: authTarget, error: authError } = await supabase.auth.admin.getUserById(req.params.id);
  if (authError || !authTarget?.user) return res.status(404).json({ error: 'Аккаунт не найден' });
  const account = authTarget.user;
  if (isRootEmail(account.email) || account.app_metadata?.flowtix_role === 'admin') return res.status(403).json({ error: 'У модератора нет права блокировать администратора' });
  const blocked = req.body.blocked === true;
  const metadata = account.app_metadata || {};
  const updated = await supabase.auth.admin.updateUserById(account.id, {
    app_metadata: { ...metadata, flowtix_role: validRoles.has(metadata.flowtix_role) ? metadata.flowtix_role : 'visitor', flowtix_blocked: blocked }
  });
  if (updated.error) return res.status(500).json({ error: 'Не удалось сохранить блокировку аккаунта' });
  await supabase.from('users').update({ is_blocked: blocked }).eq('id', account.id);
  await supabase.from('audit_logs').insert({
    actor_id: req.user.id, actor_name: req.user.full_name, action: blocked ? 'MODERATOR_USER_BLOCKED' : 'MODERATOR_USER_UNBLOCKED',
    entity_type: 'user', entity_id: account.id, details: { email: account.email }
  });
  res.json({ user: { id: account.id, email: account.email, is_blocked: blocked } });
}));
app.get('/api/moderation/reviews', requireUser, allowRoles('moderator','admin'), asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('reviews')
    .select('id,event_id,user_id,overall_rating,comment,created_at,users(full_name,email),events(title)')
    .order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить отзывы' });
  res.json({ reviews: data });
}));
app.delete('/api/moderation/reviews/:id', requireUser, allowRoles('moderator','admin'), asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('reviews').delete().eq('id', req.params.id).select('id,event_id').maybeSingle();
  if (error) return res.status(400).json({ error: 'Не удалось удалить отзыв' });
  if (!data) return res.status(404).json({ error: 'Отзыв не найден' });
  await supabase.from('audit_logs').insert({
    actor_id: req.user.id, actor_name: req.user.full_name, action: 'MODERATOR_REVIEW_REMOVED',
    entity_type: 'review', entity_id: data.id, details: { event_id: data.event_id }
  });
  res.json({ success: true });
}));

app.get('/api/admin/audit-logs', requireUser, allowRoles('admin'), asyncRoute(async (req, res) => {
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const { data, error } = await supabase.from('audit_logs').select('*')
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 10);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить журнал' });
  const logs = (data || []).slice(0, 10);
  const ids = (type) => [...new Set(logs.filter((row) => row.entity_type === type && row.entity_id).map((row) => row.entity_id))];
  const eventIds = [...new Set([
    ...ids('event'),
    ...logs.map((row) => row.details?.event_id).filter(Boolean)
  ])];
  const [users, events, tickets] = await Promise.all([
    ids('user').length ? supabase.from('users').select('id,full_name,email').in('id', ids('user')) : Promise.resolve({ data: [] }),
    eventIds.length ? supabase.from('events').select('id,title').in('id', eventIds) : Promise.resolve({ data: [] }),
    ids('ticket').length ? supabase.from('tickets').select('id,ticket_number,event_id').in('id', ids('ticket')) : Promise.resolve({ data: [] })
  ]);
  const userById = new Map((users.data || []).map((user) => [user.id, user]));
  const eventById = new Map((events.data || []).map((event) => [event.id, event]));
  const ticketById = new Map((tickets.data || []).map((ticket) => [ticket.id, ticket]));
  const roleNames = { visitor: 'Посетитель', organizer: 'Организатор', staff: 'Сотрудник', moderator: 'Модератор', admin: 'Администратор' };
  const statusNames = { published: 'Опубликовано', draft: 'Черновик', canceled: 'Отменено', cancelled: 'Отменено', archived: 'В архиве', pending: 'На проверке' };
  const settingNames = { site_name: 'Название сайта', support_email: 'Почта поддержки', maintenance_mode: 'Режим обслуживания', visual_payments_enabled: 'Визуальные платежи' };
  const logsWithLabels = logs.map((row) => {
    const details = row.details || {};
    const ticket = row.entity_type === 'ticket' ? ticketById.get(row.entity_id) : null;
    const eventId = row.entity_type === 'event' ? row.entity_id : (ticket?.event_id || details.event_id);
    const eventName = eventById.get(eventId)?.title;
    let entityLabel = 'Настройки платформы';
    if (row.entity_type === 'user') {
      const user = userById.get(row.entity_id);
      entityLabel = user?.full_name || user?.email || details.email || 'Аккаунт пользователя';
    } else if (row.entity_type === 'event') {
      entityLabel = eventById.get(row.entity_id)?.title || 'Мероприятие';
    } else if (row.entity_type === 'ticket') {
      entityLabel = ['Билет ' + (ticket?.ticket_number || details.ticket_number || ''), eventName].filter(Boolean).join(' · ');
    } else if (row.entity_type && row.entity_type !== 'platform_settings') {
      entityLabel = ({ venue: 'Площадка', review: 'Отзыв', complaint: 'Жалоба' })[row.entity_type] || 'Запись';
    }
    let detailLabel = '';
    if (row.action === 'REGISTER_FOR_EVENT') {
      const amount = Number(details.amount || 0);
      detailLabel = [eventName, amount > 0 ? 'Оплачено ' + amount.toLocaleString('ru-RU') + ' ₸' : 'Без оплаты'].filter(Boolean).join(' · ');
    } else if (row.action === 'USER_ROLE_CHANGED') {
      detailLabel = details.role ? 'Новая роль: ' + (roleNames[details.role] || 'Посетитель') : '';
    } else if (row.action === 'ADMIN_EVENT_STATUS_CHANGED') {
      detailLabel = details.status ? 'Статус: ' + (statusNames[details.status] || 'обновлён') : '';
    } else if (row.action === 'USER_BLOCKED' || row.action === 'USER_UNBLOCKED') {
      detailLabel = details.email || '';
    } else if (row.action === 'ADMIN_SETTINGS_UPDATED') {
      detailLabel = Object.keys(details).map((key) => settingNames[key]).filter(Boolean).join(', ');
    } else if (row.action === 'ADMIN_TICKET_CANCELLED' || row.action === 'ADMIN_TICKET_DELETED') {
      detailLabel = details.refund ? 'Возврат на баланс: ' + Number(details.refund).toLocaleString('ru-RU') + ' ₸' : '';
    }
    return { ...row, entity_label: entityLabel, detail_label: detailLabel };
  });
  res.json({ logs: logsWithLabels, hasMore: (data || []).length > 10 });
}));
async function countAuthUsers(){
  let count=0;
  for(let page=1;;page++){
    const {data,error}=await supabase.auth.admin.listUsers({page,perPage:1000});
    if(error)throw error;
    const batch=data?.users||[];
    count+=batch.length;
    if(batch.length<1000)return count;
  }
}

app.get('/api/admin/statistics', requireUser, allowRoles('admin'), asyncRoute(async (_req, res) => {
  const [userCount, events, tickets, payments, complaints] = await Promise.all([
    countAuthUsers(),
    supabase.from('events').select('id', { count: 'exact', head: true }),
    supabase.from('tickets').select('id', { count: 'exact', head: true }),
    supabase.from('payments').select('amount', { count: 'exact' }).eq('status', 'completed'),
    supabase.from('complaints').select('id', { count: 'exact', head: true }).in('status', ['new','in_review'])
  ]);
  if ([events,tickets,payments,complaints].some((x) => x.error)) return res.status(500).json({ error: 'Не удалось рассчитать статистику' });
  const revenue = (payments.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  res.json({ users: userCount, events: events.count, tickets: tickets.count, revenue, openComplaints: complaints.count });
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
  const { data, error } = await supabase.from('venues').select('*').or('owner_id.eq.' + req.user.id + ',owner_id.is.null').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить ваши площадки' });
  res.json({ venues: data });
}));
app.get('/api/organizer/halls', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('halls')
    .select('id,name,venue_id,total_capacity,layout_config,venues(name,address,city,owner_id)')
    .order('name');
  if (error) return res.status(500).json({ error: 'Не удалось загрузить схемы залов' });
  const halls = (data || []).filter(hall => req.user.role === 'admin' || !hall.venues?.owner_id || hall.venues.owner_id === req.user.id);
  res.json({ halls });
}));
app.post('/api/organizer/halls', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const venueId = String(req.body.venueId || '');
  const name = String(req.body.name || '').trim().slice(0,160);
  const capacity = Number(req.body.capacity);
  const cols = Number(req.body.cols);
  if (!venueId || !name || !Number.isInteger(capacity) || capacity < 1 || capacity > 2000 ||
      !Number.isInteger(cols) || cols < 1 || cols > 40) {
    return res.status(400).json({ error: 'Укажите площадку, название зала, вместимость и число мест в ряду' });
  }
  const { data: venue } = await supabase.from('venues').select('id,owner_id').eq('id', venueId).maybeSingle();
  if (!venue || (venue.owner_id && venue.owner_id !== req.user.id && req.user.role !== 'admin') ||
      (!venue.owner_id && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Создать схему можно только для своей площадки' });
  }
  const rows = Math.ceil(capacity / cols);
  const { data: hall, error } = await supabase.from('halls').insert({
    venue_id: venue.id, name, total_capacity: capacity, layout_config: { rows, cols }
  }).select('id,name,venue_id,total_capacity,layout_config').single();
  if (error) return res.status(400).json({ error: 'Не удалось создать схему зала' });
  const { error: seatError } = await supabase.rpc('ensure_hall_seats', { p_hall_id: hall.id });
  if (seatError) {
    await supabase.from('halls').delete().eq('id', hall.id);
    return res.status(500).json({ error: 'Схема зала создана не полностью. Попробуйте снова.' });
  }
  res.status(201).json({ hall });
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
app.get('/api/promos/validate', requireUser, asyncRoute(async (req,res)=>{
  const code=String(req.query.code||'').trim().toUpperCase().slice(0,32),eventId=String(req.query.eventId||''),seatId=String(req.query.seatId||'');
  if(!code||!eventId)return res.status(400).json({error:'Введите промокод'});
  const [{data:promo},{data:event}] = await Promise.all([
    supabase.from('promo_codes').select('*').eq('code',code).eq('is_active',true).is('deleted_at',null).maybeSingle(),
    supabase.from('events').select('id,title,organizer_id,category_id,current_price,base_price').eq('id',eventId).eq('status','published').maybeSingle()
  ]);
  if(!promo)return res.status(404).json({error:'Промокод не найден или отключён'});
  if(!event)return res.status(404).json({error:'Мероприятие не найдено'});
  if(promo.expires_at&&new Date(promo.expires_at)<=new Date())return res.status(400).json({error:'Срок действия промокода истёк'});
  if(promo.max_uses!=null&&Number(promo.current_uses||0)>=Number(promo.max_uses))return res.status(400).json({error:'Лимит использований промокода исчерпан'});
  if(promo.organizer_id&&promo.organizer_id!==event.organizer_id)return res.status(400).json({error:'Промокод действует на мероприятия другого организатора'});
  if(promo.event_id&&promo.event_id!==event.id)return res.status(400).json({error:'Промокод действует на другое мероприятие'});
  if(promo.category_id&&promo.category_id!==event.category_id)return res.status(400).json({error:'Промокод действует на другую категорию'});
  let multiplier=1;
  if(promo.seat_type){
    if(!seatId)return res.status(400).json({error:'Промокод действует только на выбранный тип места'});
    const {data:seat}=await supabase.from('seats').select('seat_type,price_multiplier').eq('id',seatId).maybeSingle();
    if(!seat||seat.seat_type!==promo.seat_type)return res.status(400).json({error:'Промокод не действует на выбранный тип билета'});
    multiplier=Number(seat.price_multiplier||1);
  }
  if(promo.only_new_users){
    const {count}=await supabase.from('registrations').select('id',{count:'exact',head:true}).eq('user_id',req.user.id);
    if(count)return res.status(400).json({error:'Промокод доступен только новым пользователям'});
  }
  const subtotal=Math.round(Number(event.current_price??event.base_price??0)*multiplier*100)/100;
  if(subtotal<Number(promo.min_amount||0))return res.status(400).json({error:'Минимальная сумма для промокода — '+Number(promo.min_amount||0).toLocaleString('ru-RU')+' ₸'});
  const discount=Math.round(subtotal*Math.min(100,Math.max(0,Number(promo.discount_percent)||0))/100*100)/100;
  res.json({code:promo.code,discount,subtotal,amount:Math.max(0,subtotal-discount),discountPercent:promo.discount_percent});
}));
app.get('/api/recommendations', requireUser, asyncRoute(async(req,res)=>{
  const [profile,favorites,tickets,views,events,blocks]=await Promise.all([
    supabase.from('users').select('city,preferences').eq('id',req.user.id).maybeSingle(),
    supabase.from('favorites').select('event_id').eq('user_id',req.user.id),
    supabase.from('tickets').select('event_id').eq('user_id',req.user.id),
    supabase.from('event_views').select('event_id,view_count,last_viewed_at').eq('user_id',req.user.id).order('last_viewed_at',{ascending:false}).limit(100),
    supabase.from('events').select('id,title,description,cover_image,location_address,start_date,start_time,created_at,base_price,current_price,total_seats,available_seats,status,age_limit,popularity_score,venue_id,category_id,organizer_id,event_categories(name),venues(name,address,city),users!events_organizer_id_fkey(id,full_name,username,avatar_url)').eq('status','published').order('start_date'),
    supabase.from('user_blocks').select('blocked_id').eq('blocker_id',req.user.id)
  ]);
  if(events.error)return res.status(500).json({error:'Не удалось загрузить рекомендации'});
  const favoritesList=favorites.data||[],ticketsList=tickets.data||[],viewsList=views.data||[];
  const interestIds=[...new Set([...favoritesList,...ticketsList,...viewsList].map(x=>String(x.event_id)).filter(Boolean))];
  const historyResult=interestIds.length?await supabase.from('events').select('id,category_id').in('id',interestIds):{data:[],error:null};
  const categoryWeights=new Map();
  const addCategory=(id,weight)=>{if(id)categoryWeights.set(String(id),(categoryWeights.get(String(id))||0)+weight)};
  const historyById=new Map((historyResult.data||[]).map(x=>[String(x.id),x]));
  for(const x of favoritesList)addCategory(historyById.get(String(x.event_id))?.category_id,5);
  for(const x of ticketsList)addCategory(historyById.get(String(x.event_id))?.category_id,8);
  for(const x of viewsList)addCategory(historyById.get(String(x.event_id))?.category_id,Math.min(6,1+Number(x.view_count||1)));
  const ticketEventIds=new Set(ticketsList.map(x=>String(x.event_id)));
  const prefs=profile.data?.preferences?.categories||[];
  const prefSet=new Set(prefs.map(String).map(x=>x.toLocaleLowerCase('ru')));
  const blocked=new Set((blocks.data||[]).map(x=>String(x.blocked_id)));
  const city=String(profile.data?.city||'').trim().toLocaleLowerCase('ru');
  const today=new Date().toISOString().slice(0,10);
  const ranked=(events.data||[]).filter(e=>String(e.start_date||'')>=today&&!blocked.has(String(e.organizer_id))&&!ticketEventIds.has(String(e.id))).map(e=>{
    const categoryWeight=Number(categoryWeights.get(String(e.category_id||''))||0);
    const score=categoryWeight+(prefSet.has(String(e.category_id||'').toLocaleLowerCase('ru'))||prefSet.has(String(e.event_categories?.name||'').toLocaleLowerCase('ru'))?5:0)
      +(city&&String(e.venues?.city||'').toLocaleLowerCase('ru')===city?4:0)
      +Math.min(5,Number(e.popularity_score||0)/20);
    return {...e,recommendation_score:score};
  }).sort((a,b)=>b.recommendation_score-a.recommendation_score||String(a.start_date).localeCompare(String(b.start_date))).slice(0,10);
  res.json({events:ranked});
}));
app.post('/api/events/:id/view', requireUser, asyncRoute(async(req,res)=>{
  const eventId=String(req.params.id||'');
  const {data:event}=await supabase.from('events').select('id').eq('id',eventId).eq('status','published').maybeSingle();
  if(!event)return res.status(404).json({error:'Мероприятие не найдено'});
  const {data:existing}=await supabase.from('event_views').select('view_count').eq('user_id',req.user.id).eq('event_id',eventId).maybeSingle();
  const {error}=await supabase.from('event_views').upsert({user_id:req.user.id,event_id:eventId,view_count:Number(existing?.view_count||0)+1,last_viewed_at:new Date().toISOString()},{onConflict:'user_id,event_id'});
  if(error)return res.status(500).json({error:'Не удалось сохранить просмотр'});
  res.status(204).end();
}));
const promoPayload=(body,organizerId=null)=>({
  organizer_id:organizerId||body.organizer_id||null,
  code:String(body.code||'').trim().toUpperCase(),
  discount_percent:Number(body.discount_percent),
  min_amount:Number(body.min_amount||0),
  max_uses:body.max_uses===''||body.max_uses==null?null:Number(body.max_uses),
  only_new_users:body.only_new_users===true||body.only_new_users==='on',
  expires_at:body.expires_at?(Number.isFinite(Date.parse(body.expires_at))?new Date(body.expires_at).toISOString():'invalid'):null,
  category_id:body.category_id||null,
  seat_type:body.seat_type||null,
  event_id:body.event_id||null,
  is_active:true
});
const validatePromoPayload=(p)=>{
 if(!/^[A-Z0-9_-]{3,32}$/.test(p.code)||!Number.isInteger(p.discount_percent)||p.discount_percent<1||p.discount_percent>100||!Number.isFinite(p.min_amount)||p.min_amount<0||p.max_uses!==null&&(!Number.isInteger(p.max_uses)||p.max_uses<1)||p.expires_at&&Number.isNaN(Date.parse(p.expires_at)))return 'Проверьте код, скидку, сумму, лимит и срок действия';
 return '';
};
app.get('/api/organizer/promos',requireUser,allowRoles('organizer','admin'),asyncRoute(async(req,res)=>{
 const offset=Math.max(0,parseInt(req.query.offset||'0',10)||0);
 const {data,count,error}=await supabase.from('promo_codes').select('id,code,discount_percent,min_amount,max_uses,current_uses,only_new_users,expires_at,is_active,category_id,seat_type,event_id,organizer_id,created_at',{count:'exact'}).eq('organizer_id',req.user.id).is('deleted_at',null).order('created_at',{ascending:false}).range(offset,offset+9);
 if(error)return res.status(500).json({error:'Не удалось загрузить промокоды'});
 res.json({promos:data||[],offset,hasMore:offset+(data||[]).length<(count||0)});
}));
app.post('/api/organizer/promos',requireUser,allowRoles('organizer','admin'),asyncRoute(async(req,res)=>{
 const promo=promoPayload(req.body,req.user.id),invalid=validatePromoPayload(promo);
 if(invalid)return res.status(400).json({error:invalid});
 if(promo.event_id){const {data:event}=await supabase.from('events').select('id').eq('id',promo.event_id).eq('organizer_id',req.user.id).maybeSingle();if(!event)return res.status(400).json({error:'Выберите своё мероприятие'})}
 const {data,error}=await supabase.from('promo_codes').insert(promo).select('*').single();
 if(error)return res.status(400).json({error:error.code==='23505'?'Такой промокод уже существует':'Не удалось создать промокод'});
 res.status(201).json({promo:data});
}));
app.get('/api/admin/promos',requireUser,requireRootAdmin,asyncRoute(async(req,res)=>{
 const offset=Math.max(0,parseInt(req.query.offset||'0',10)||0);
 const {data,count,error}=await supabase.from('promo_codes').select('id,code,discount_percent,min_amount,max_uses,current_uses,only_new_users,expires_at,is_active,category_id,seat_type,event_id,organizer_id,created_at',{count:'exact'}).is('deleted_at',null).order('created_at',{ascending:false}).range(offset,offset+9);
 if(error)return res.status(500).json({error:'Не удалось загрузить промокоды'});
 res.json({promos:data||[],offset,hasMore:offset+(data||[]).length<(count||0)});
}));
app.post('/api/admin/promos',requireUser,requireRootAdmin,asyncRoute(async(req,res)=>{
 const promo=promoPayload(req.body),invalid=validatePromoPayload(promo);
 if(invalid)return res.status(400).json({error:invalid});
 const {data,error}=await supabase.from('promo_codes').insert(promo).select('*').single();
 if(error)return res.status(400).json({error:error.code==='23505'?'Такой промокод уже существует':'Не удалось создать промокод'});
 await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:'ADMIN_PROMO_CREATED',entity_type:'promo_code',entity_id:data.id,details:{code:data.code,discount_percent:data.discount_percent}});
 res.status(201).json({promo:data});
}));
app.patch('/api/admin/promos/:id',requireUser,requireRootAdmin,asyncRoute(async(req,res)=>{
 const active=req.body.is_active;
 if(typeof active!=='boolean')return res.status(400).json({error:'Укажите новое состояние промокода'});
 const {data,error}=await supabase.from('promo_codes').update({is_active:active}).eq('id',req.params.id).select('id,code,is_active').maybeSingle();
 if(error)return res.status(400).json({error:'Не удалось изменить промокод'});
 if(!data)return res.status(404).json({error:'Промокод не найден'});
 await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:active?'ADMIN_PROMO_ENABLED':'ADMIN_PROMO_DISABLED',entity_type:'promo_code',entity_id:data.id,details:{code:data.code}});
 res.json({promo:data});
}));
async function removePromo(id, organizerId=null) {
 let query=supabase.from('promo_codes').select('id,code,current_uses,organizer_id').eq('id',id).is('deleted_at',null);
 if(organizerId)query=query.eq('organizer_id',organizerId);
 const {data:promo,error:lookupError}=await query.maybeSingle();
 if(lookupError)return {error:lookupError};
 if(!promo)return {missing:true};
 const archive=async()=>supabase.from('promo_codes').update({is_active:false,deleted_at:new Date().toISOString()}).eq('id',promo.id).select('id').maybeSingle();
 let archived=Number(promo.current_uses||0)>0;
 if(archived){const result=await archive();if(result.error)return {error:result.error}}
 else {
   const {error}=await supabase.from('promo_codes').delete().eq('id',promo.id);
   if(error&&error.code==='23503'){archived=true;const result=await archive();if(result.error)return {error:result.error}}
   else if(error)return {error};
 }
 return {promo,archived};
}
app.delete('/api/admin/promos/:id',requireUser,requireRootAdmin,asyncRoute(async(req,res)=>{
 const result=await removePromo(req.params.id);
 if(result.error)return res.status(400).json({error:'Не удалось удалить промокод'});
 if(result.missing)return res.status(404).json({error:'Промокод не найден'});
 await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:'ADMIN_PROMO_DELETED',entity_type:'promo_code',entity_id:result.promo.id,details:{code:result.promo.code,archived:result.archived}});
 res.json({deleted:true,archived:result.archived});
}));
app.delete('/api/organizer/promos/:id',requireUser,allowRoles('organizer','admin'),asyncRoute(async(req,res)=>{
 const result=await removePromo(req.params.id,req.user.id);
 if(result.error)return res.status(400).json({error:'Не удалось удалить промокод'});
 if(result.missing)return res.status(404).json({error:'Промокод не найден'});
 res.json({deleted:true,archived:result.archived});
}));
app.get('/api/admin/users', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const offset = Math.max(0, Number.parseInt(String(req.query.offset || '0'), 10) || 0);
  const page = Math.floor(offset / 10) + 1;
  const [{ data: authResult, error: authError }, { data: nextPage, error: nextPageError }] = await Promise.all([
    supabase.auth.admin.listUsers({ page, perPage: 10 }),
    supabase.auth.admin.listUsers({ page: page + 1, perPage: 10 })
  ]);
  if (authError || nextPageError) return res.status(500).json({ error: 'Не удалось загрузить аккаунты Auth' });
  const authUsers = authResult.users || [];
  if (!authUsers.length) return res.json({ users: [], hasMore: false, offset });
  const { data: profiles, error } = await supabase.from('users')
    .select('id,full_name,username,avatar_url,role,is_blocked,created_at')
    .in('id', authUsers.map((account) => account.id));
  if (error) return res.status(500).json({ error: 'Не удалось загрузить профили пользователей' });
  const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const users = authUsers.map((account) => {
    const profile = byId.get(account.id) || {};
    const metadata = account.app_metadata || {};
    const isRootAdmin = isRootEmail(account.email);
    const role = isRootAdmin ? 'admin' : (validRoles.has(metadata.flowtix_role) && metadata.flowtix_role !== 'admin' ? metadata.flowtix_role : 'visitor');
    return {
      id: account.id, email: account.email, full_name: profile.full_name || account.user_metadata?.full_name || '',
      username: profile.username || null, avatar_url: profile.avatar_url || null,
      role, is_blocked: !isRootAdmin && profile.is_blocked === true,
      created_at: account.created_at
    };
  }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ users, hasMore: (nextPage?.users || []).length > 0, offset });
}));

app.get('/api/admin/events', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10) || 0);
  const limit = 10;
  const { data, count, error } = await supabase.from('events')
    .select('id,title,status,start_date,start_time,total_seats,available_seats,base_price,organizer_id,venue_id,location_address,created_at,users!events_organizer_id_fkey(full_name,email),venues(name,city,address)', { count: 'exact' })
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить мероприятия' });
  const events = data || [];
  res.json({ events, offset, limit, hasMore: offset + events.length < (count || 0) });
}));
app.delete('/api/admin/events/:id', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('events')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .neq('status', 'cancelled')
    .eq('id', req.params.id)
    .select('id,title')
    .maybeSingle();
  if (error) return res.status(400).json({ error: 'Не удалось удалить мероприятие' });
  if (!data) return res.status(404).json({ error: 'Мероприятие не найдено' });
  await supabase.from('audit_logs').insert({
    actor_id: req.user.id, actor_name: req.user.full_name, action: 'ADMIN_EVENT_ARCHIVED',
    entity_type: 'event', entity_id: data.id, details: { title: data.title, retainedHistory: true }
  });
  res.json({ deleted: true, retainedHistory: true, event: data });
}));
app.patch('/api/admin/events/:id', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const status = String(req.body.status || '');
  if (!['draft','pending_moderation','published','rejected','cancelled','completed'].includes(status)) return res.status(400).json({ error: 'Недопустимый статус события' });
  const { data, error } = await supabase.from('events').update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select('id,title,status').maybeSingle();
  if (error) return res.status(400).json({ error: 'Не удалось изменить мероприятие' });
  if (!data) return res.status(404).json({ error: 'Мероприятие не найдено' });
  await supabase.from('audit_logs').insert({ actor_id: req.user.id, actor_name: req.user.full_name, action: 'ADMIN_EVENT_STATUS_CHANGED', entity_type: 'event', entity_id: data.id, details: { status } });
  res.json({ event: data });
}));
app.get('/api/admin/venues', requireUser, requireRootAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('venues')
    .select('id,name,city,address,description,owner_id,users!venues_owner_id_fkey(full_name,email)')
    .order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить площадки' });
  res.json({ venues: data });
}));
app.patch('/api/admin/venues/:id', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const changes = {};
  for (const key of ['name','city','address','description']) {
    if (req.body[key] !== undefined) changes[key] = String(req.body[key]).trim().slice(0, key === 'description' ? 3000 : 240);
  }
  if (!Object.keys(changes).length || (changes.name !== undefined && !changes.name) || (changes.city !== undefined && !changes.city) || (changes.address !== undefined && !changes.address)) {
    return res.status(400).json({ error: 'Проверьте название, город и адрес площадки' });
  }
  const { data, error } = await supabase.from('venues').update(changes).eq('id', req.params.id).select('id,name,city,address,description').maybeSingle();
  if (error) return res.status(400).json({ error: 'Не удалось изменить площадку' });
  if (!data) return res.status(404).json({ error: 'Площадка не найдена' });
  await supabase.from('audit_logs').insert({ actor_id: req.user.id, actor_name: req.user.full_name, action: 'ADMIN_VENUE_UPDATED', entity_type: 'venue', entity_id: data.id, details: changes });
  res.json({ venue: data });
}));
app.get('/api/admin/tickets', requireUser, requireRootAdmin, asyncRoute(async (req,res)=>{
 const offset=Math.max(0,parseInt(req.query.offset||'0',10)||0);
 const {data,error}=await supabase.from('tickets').select('id,ticket_number,status,price_paid,seat_label,created_at,event_id,user_id,events!tickets_event_id_fkey(title,start_date),users!tickets_user_id_fkey(full_name,email,username,avatar_url,avatar_path)').order('created_at',{ascending:false}).order('id').range(offset,offset+10);
 if(error)return res.status(500).json({error:'Не удалось загрузить билеты'});
 const tickets=await Promise.all((data||[]).slice(0,10).map(async t=>{if(t.users?.avatar_path){const signed=await supabase.storage.from('avatars').createSignedUrl(t.users.avatar_path,3600);if(signed.data)t.users.avatar_url=signed.data.signedUrl;delete t.users.avatar_path}return t}));
 res.json({tickets,hasMore:(data||[]).length>10});
}));
app.patch('/api/admin/tickets/:id/cancel',requireUser,requireRootAdmin,asyncRoute(async(req,res)=>{
 const {data:ticket}=await supabase.from('tickets').select('user_id,users!tickets_user_id_fkey(email)').eq('id',req.params.id).maybeSingle();
 if(req.body.block===true&&ticket&&isRootEmail(ticket.users?.email))return res.status(409).json({error:'Главный администратор не может быть заблокирован'});
 const {data,error}=await supabase.rpc('admin_cancel_ticket',{p_ticket_id:req.params.id,p_actor_id:req.user.id,p_refund:req.body.refund===true,p_block:req.body.block===true,p_notify:req.body.notify!==false,p_delete:req.body.deleteRecord===true});
 if(error)return res.status(400).json({error:'Не удалось аннулировать билет: '+error.message});
 res.json(data);
}));
app.delete('/api/admin/tickets/:id',requireUser,requireRootAdmin,asyncRoute(async(req,res)=>{
 const {data,error}=await supabase.rpc('admin_delete_ticket_record',{p_ticket_id:req.params.id,p_actor_id:req.user.id});
 if(error)return res.status(400).json({error:'Сначала аннулируйте действующий билет'});
 res.json(data);
}));
app.get('/api/wallet',requireUser,asyncRoute(async(req,res)=>{
 const offset=Math.max(0,parseInt(req.query.offset||'0',10)||0);
 const [account,ledger,setting]=await Promise.all([
 supabase.from('wallet_accounts').select('balance').eq('user_id',req.user.id).maybeSingle(),
 supabase.from('wallet_transactions').select('id,amount,balance_after,kind,description,created_at').eq('user_id',req.user.id).order('created_at',{ascending:false}).order('id').range(offset,offset+10),
 supabase.from('platform_settings').select('value').eq('key','visual_payments_enabled').maybeSingle()]);
 if(account.error||ledger.error||setting.error)return res.status(500).json({error:'Не удалось загрузить баланс'});
 res.json({balance:account.data?.balance||0,currency:'KZT',visualTopups:setting.data?.value===true,transactions:(ledger.data||[]).slice(0,10),hasMore:(ledger.data||[]).length>10});
}));
app.post('/api/wallet/topups',requireUser,asyncRoute(async(req,res)=>{
 const amount=Number(req.body.amount),key=String(req.body.idempotencyKey||'');
 if(!Number.isFinite(amount)||amount<=0||amount>1000000||!/^[-a-z0-9]{16,80}$/i.test(key))return res.status(400).json({error:'Укажите сумму от 1 до 1 000 000 ₸'});
 const {data,error}=await supabase.rpc('wallet_topup',{p_user_id:req.user.id,p_amount:amount,p_key:key});
 if(error)return res.status(error.message.includes('payment_provider_required')?501:400).json({error:error.message.includes('payment_provider_required')?'Платёжный провайдер пока не подключён. Пополнение недоступно.':'Не удалось пополнить баланс'});
 res.status(201).json({transaction:data,balance:data.balance_after});
}));
app.get('/api/admin/payments', requireUser, requireRootAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('payments')
    .select('id,user_id,ticket_id,amount,currency,payment_method,status,transaction_ref,created_at,users(full_name,email),tickets(ticket_number,events(title))')
    .order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить платежи' });
  res.json({ payments: data });
}));
app.get('/api/admin/complaints', requireUser, requireRootAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('complaints')
    .select('*,users!complaints_author_id_fkey(id,full_name,email,username)')
    .in('status',['new','in_review']).order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить жалобы' });
  try{res.json({ complaints: await enrichComplaintTargets(data||[]) })}
  catch(targetError){console.error('[admin] complaint targets failed:',targetError.message);res.status(500).json({error:'Не удалось загрузить объект жалобы'})}
}));
app.get('/api/admin/reviews', requireUser, requireRootAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('reviews')
    .select('*,users(full_name,email),events(title)')
    .order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: 'Не удалось загрузить отзывы' });
  res.json({ reviews: data });
}));
app.delete('/api/admin/reviews/:id', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from('reviews').delete().eq('id', req.params.id).select('id,event_id').maybeSingle();
  if (error) return res.status(400).json({ error: 'Не удалось удалить отзыв' });
  if (!data) return res.status(404).json({ error: 'Отзыв не найден' });
  await supabase.from('audit_logs').insert({ actor_id: req.user.id, actor_name: req.user.full_name, action: 'ADMIN_REVIEW_REMOVED', entity_type: 'review', entity_id: data.id, details: { event_id: data.event_id } });
  res.json({ success: true });
}));
app.get('/api/admin/settings', requireUser, requireRootAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('platform_settings').select('key,value,updated_at').order('key');
  if (error) return res.status(500).json({ error: 'Не удалось загрузить настройки платформы' });
  const settings = Object.fromEntries((data || []).map((item) => [item.key, item.value]));
  for (const key of ['maintenance_mode','visual_payments_enabled']) {
    if (settings[key] === 'true' || settings[key] === 'false') settings[key] = settings[key] === 'true';
  }
  res.json({ settings });
}));
app.patch('/api/admin/settings', requireUser, requireRootAdmin, asyncRoute(async (req, res) => {
  const allowed = new Set(['site_name','support_email','maintenance_mode','visual_payments_enabled']);
  const entries = Object.entries(req.body || {}).filter(([key]) => allowed.has(key));
  if (!entries.length) return res.status(400).json({ error: 'Нет допустимых настроек для сохранения' });
  const booleanKeys = new Set(['maintenance_mode','visual_payments_enabled']);
  if (entries.some(([key,value]) => booleanKeys.has(key) ? typeof value !== 'boolean' : typeof value !== 'string')) {
    return res.status(400).json({ error: 'Проверьте значения настроек' });
  }
  const writes = entries.map(([key,value]) => ({ key, value, updated_by: req.user.id, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from('platform_settings').upsert(writes, { onConflict: 'key' });
  if (error) return res.status(400).json({ error: 'Не удалось сохранить настройки платформы' });
  await supabase.from('audit_logs').insert({ actor_id: req.user.id, actor_name: req.user.full_name, action: 'ADMIN_SETTINGS_UPDATED', entity_type: 'platform_settings', details: Object.fromEntries(entries) });
  res.json({ success: true });
}));
app.get('/api/organizer/employees', requireUser, allowRoles('organizer','admin'), asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('employees')
    .select('id,position,qualification,users!employees_user_id_fkey(id,full_name,email)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Не удалось загрузить сотрудников' });
  res.json({ employees: data });
}));
app.patch('/api/events/:eventId/program/:programId', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { data: event } = await supabase.from('events').select('id')
    .eq('id', req.params.eventId).eq('organizer_id', req.user.id).maybeSingle();
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const { data: item } = await supabase.from('event_program').select('id,item_type,parent_section_id')
    .eq('id', req.params.programId).eq('event_id', event.id).maybeSingle();
  if (!item) return res.status(404).json({ error: 'Пункт программы не найден' });
  const title = String(req.body.title || '').trim();
  const start_time = String(req.body.start_time || '');
  const duration = Number(req.body.duration_minutes);
  const maxAttendees = Number(req.body.max_attendees);
  if (!title || !/^\\d{2}:\\d{2}$/.test(start_time) ||
      !Number.isInteger(duration) || duration < 1 || duration > 1440 ||
      !Number.isInteger(maxAttendees) || maxAttendees < 1 || maxAttendees > 100000) {
    return res.status(400).json({ error: 'Укажите название, время, длительность и лимит участников' });
  }
  const startMinutes = Number(start_time.slice(0,2)) * 60 + Number(start_time.slice(3,5));
  const endMinutes = (startMinutes + duration) % 1440;
  const end_time = String(Math.floor(endMinutes / 60)).padStart(2,'0') + ':' + String(endMinutes % 60).padStart(2,'0');
  const { data, error } = await supabase.from('event_program').update({
    title: title.slice(0,180), start_time, end_time, duration_minutes: duration,
    max_attendees: maxAttendees,
    speaker_name: String(req.body.speaker_name || '').trim().slice(0,160),
    room_name: String(req.body.room_name || '').trim().slice(0,120),
    description: String(req.body.description || '').trim().slice(0,2000)
  }).eq('id', item.id).eq('event_id', event.id).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось изменить пункт программы' });
  res.json({ item: data });
}));

app.delete('/api/events/:eventId/program/:programId', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { data: event } = await supabase.from('events').select('id')
    .eq('id', req.params.eventId).eq('organizer_id', req.user.id).maybeSingle();
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const { data: item } = await supabase.from('event_program').select('id,item_type')
    .eq('id', req.params.programId).eq('event_id', event.id).maybeSingle();
  if (!item) return res.status(404).json({ error: 'Пункт программы не найден' });
  if (item.item_type === 'section') {
    const { count } = await supabase.from('event_program').select('id', { count: 'exact', head: true })
      .eq('event_id', event.id).eq('parent_section_id', item.id);
    if (count) return res.status(409).json({ error: 'Сначала удалите элементы внутри этой секции' });
  }
  const { error } = await supabase.from('event_program').delete().eq('id', item.id).eq('event_id', event.id);
  if (error) return res.status(400).json({ error: 'Не удалось удалить пункт программы' });
  res.json({ deleted: true });
}));

app.post('/api/events/:eventId/program', requireUser, allowRoles('organizer','admin'), asyncRoute(async (req, res) => {
  const { data: event } = await supabase.from('events').select('id,total_seats')
    .eq('id', req.params.eventId).eq('organizer_id', req.user.id).maybeSingle();
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const { title, start_time, end_time, speaker_name, room_name, description } = req.body;
  if (!title || !start_time || !end_time) return res.status(400).json({ error: 'Заполните название и время пункта расписания' });
  const startMinutes = Number(String(start_time).slice(0, 2)) * 60 + Number(String(start_time).slice(3, 5));
  const endMinutes = Number(String(end_time).slice(0, 2)) * 60 + Number(String(end_time).slice(3, 5));
  const duration = (endMinutes - startMinutes + 1440) % 1440;
  if (!duration) return res.status(400).json({ error: 'Укажите длительность больше нуля' });
  let parentId = null;
  if (req.body.parent_section_id) {
    const { data: parent } = await supabase.from('event_program').select('id,item_type')
      .eq('id', req.body.parent_section_id).eq('event_id', event.id).maybeSingle();
    if (!parent || parent.item_type !== 'section') return res.status(400).json({ error: 'Выберите секцию этого мероприятия' });
    parentId = parent.id;
  }
  const { data, error } = await supabase.from('event_program').insert({
    event_id: event.id, parent_section_id: parentId, item_type: 'activity',
    title: String(title).trim().slice(0,180), start_time, end_time, duration_minutes: duration,
    max_attendees: Number.isInteger(Number(req.body.max_attendees)) && Number(req.body.max_attendees) > 0 ? Number(req.body.max_attendees) : Number(event.total_seats || 1),
    speaker_name: String(speaker_name || '').slice(0,160),
    room_name: String(room_name || '').slice(0,120),
    description: String(description || '').slice(0,2000)
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'Не удалось добавить пункт расписания' });
  res.status(201).json({ item: data });
}));


function safePlatformFromUrl(raw) {
  let parsed;
  try { parsed = new URL(String(raw || '').trim()); } catch { return null; }
  if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\\./, '');
  const map = [['t.me','telegram'],['telegram.me','telegram'],['youtube.com','youtube'],['youtu.be','youtube'],['instagram.com','instagram'],['tiktok.com','tiktok'],['vk.com','vk'],['discord.gg','discord'],['discord.com','discord'],['x.com','x'],['twitter.com','x']];
  const platform = map.find(([domain]) => host === domain || host.endsWith('.' + domain))?.[1] || 'website';
  return { url: parsed.toString(), platform };
}
async function signedUserAvatar(profile) {
  if (!profile) return profile;
  const result = { ...profile };
  delete result.avatar_path;
  if (profile.avatar_path) {
    const signed = await supabase.storage.from('avatars').createSignedUrl(profile.avatar_path, 3600);
    if (!signed.error && signed.data?.signedUrl) result.avatar_url = signed.data.signedUrl;
  }
  return result;
}
async function conversationParty(conversation, userId) {
  const otherId = conversation.participant_a === userId ? conversation.participant_b : conversation.participant_a;
  const { data } = await supabase.from('users').select('id,full_name,username,avatar_url,avatar_path,role,city,preferences').eq('id', otherId).maybeSingle();
  return { other: await signedUserAvatar(data), otherId };
}

app.get('/api/profiles/:id', asyncRoute(async (req, res) => {
  let viewerId = null;
  const token = req.get('authorization')?.replace(/^Bearer\\s+/i, '');
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    viewerId = data?.user?.id || null;
  }
  const lookup=String(req.params.id||'').trim();
  let profileQuery=supabase.from('users').select('id,full_name,username,avatar_url,avatar_path,role,city,preferences,is_blocked');
  if(/^[0-9a-f-]{36}$/i.test(lookup))profileQuery=profileQuery.eq('id',lookup);
  else if(/^[a-z0-9_]{3,24}$/i.test(lookup))profileQuery=profileQuery.eq('username',lookup);
  else return res.status(404).json({error:'Профиль не найден'});
  const { data: profile, error } = await profileQuery.maybeSingle();
  if (error) return res.status(500).json({ error: 'Не удалось загрузить профиль' });
  if (!profile || profile.is_blocked) return res.status(404).json({ error: 'Профиль не найден' });
  let blocked = false;
  if (viewerId && viewerId !== profile.id) {
    const { data: blocks, error: blockError } = await supabase.from('user_blocks')
      .select('blocker_id,blocked_id').or('and(blocker_id.eq.'+viewerId+',blocked_id.eq.'+profile.id+'),and(blocker_id.eq.'+profile.id+',blocked_id.eq.'+viewerId+')');
    if (blockError) return res.status(500).json({ error: 'Не удалось проверить доступ к профилю' });
    blocked = (blocks || []).length > 0;
  }
  if (blocked) return res.status(404).json({ error: 'Профиль недоступен' });
  const { data: links, error: linksError } = await supabase.from('profile_links').select('id,url,platform')
    .eq('user_id', profile.id).eq('status','approved').order('created_at');
  if (linksError) return res.status(500).json({ error: 'Не удалось загрузить ссылки профиля' });
  const {data:hostedEvents,error:eventsError}=await supabase.from('events')
    .select('id,title,start_date,start_time,location_address,cover_image,venues(name,city,address)')
    .eq('organizer_id',profile.id).eq('status','published')
    .gte('start_date',new Date().toISOString().slice(0,10))
    .order('start_date',{ascending:true}).limit(12);
  if(eventsError)return res.status(500).json({error:'Не удалось загрузить мероприятия профиля'});
  res.json({ profile: await signedUserAvatar({
    id: profile.id, full_name: profile.full_name, username: profile.username, avatar_url: profile.avatar_url,
    avatar_path: profile.avatar_path, role: profile.role, city: profile.city,
    about: profile.preferences?.about || '', links: links || [], events:hostedEvents||[]
  }) });
}));

app.post('/api/me/profile-links', requireUser, asyncRoute(async (req, res) => {
  const value = safePlatformFromUrl(req.body.url);
  if (!value) return res.status(400).json({ error: 'Добавьте корректную ссылку с http:// или https://' });
  const { data: existing, error: lookupError } = await supabase.from('profile_links')
    .select('id,status').eq('user_id',req.user.id).ilike('url',value.url).in('status',['pending','approved']).maybeSingle();
  if (lookupError) return res.status(500).json({ error: 'Не удалось проверить ссылку' });
  if (existing) return res.status(409).json({ error: existing.status === 'approved' ? 'Эта ссылка уже опубликована' : 'Эта ссылка уже ожидает проверки' });
  const { data, error } = await supabase.from('profile_links').insert({
    user_id:req.user.id,url:value.url,platform:value.platform,status:'pending'
  }).select('id,url,platform,status,created_at').single();
  if (error) return res.status(400).json({ error:'Не удалось отправить ссылку на модерацию' });
  await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:'PROFILE_LINK_SUBMITTED',entity_type:'profile_link',entity_id:data.id,details:{platform:value.platform}});
  await notifyRootAdmin('Новая ссылка на модерацию',(req.user.full_name||'Пользователь')+' отправил ссылку на проверку.','profile_link_moderation');
  res.status(201).json({ link:data });
}));
app.delete('/api/me/profile-links/:id', requireUser, asyncRoute(async(req,res)=>{
 const {data,error}=await supabase.from('profile_links').delete().eq('id',req.params.id).eq('user_id',req.user.id).select('id').maybeSingle();
 if(error)return res.status(400).json({error:'Не удалось удалить ссылку'});
 if(!data)return res.status(404).json({error:'Ссылка не найдена'});
 res.json({deleted:true});
}));
app.get('/api/me/profile-links', requireUser, asyncRoute(async (req,res)=>{
  const {data,error}=await supabase.from('profile_links').select('id,url,platform,status,created_at,moderated_at')
    .eq('user_id',req.user.id).order('created_at',{ascending:false});
  if(error)return res.status(500).json({error:'Не удалось загрузить ваши ссылки'});
  res.json({links:data||[]});
}));

app.get('/api/messages/conversations', requireUser, asyncRoute(async (req,res)=>{
  const {data,error}=await supabase.from('direct_conversations')
    .select('id,participant_a,participant_b,request_by,status,cleared_at_a,cleared_at_b,last_read_at_a,last_read_at_b,created_at,updated_at')
    .or('participant_a.eq.'+req.user.id+',participant_b.eq.'+req.user.id)
    .order('updated_at',{ascending:false});
  if(error)return res.status(500).json({error:'Не удалось загрузить переписки'});
  const conversations=await Promise.all((data||[]).map(async c=>{
    const party=await conversationParty(c,req.user.id);
    const {data:last}=await supabase.from('direct_messages').select('body,created_at,sender_id')
      .eq('conversation_id',c.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
    const ownSide=c.participant_a===req.user.id?'a':'b';
    const readAt=c[ownSide==='a'?'last_read_at_a':'last_read_at_b']||c.created_at;
    let unreadCount=0;
    if(c.status==='active'){
      const unread=await supabase.from('direct_messages').select('id',{count:'exact',head:true})
        .eq('conversation_id',c.id).neq('sender_id',req.user.id).gt('created_at',readAt);
      unreadCount=unread.error?0:(unread.count||0);
    }
    return {...c,other:party.other,lastMessage:last||null,unreadCount,
      clearedAt:c.participant_a===req.user.id?c.cleared_at_a:c.cleared_at_b};
  }));
  res.json({conversations});
}));
app.post('/api/messages/requests', requireUser, asyncRoute(async(req,res)=>{
  const otherId=String(req.body.userId||'');
  if(!/^[0-9a-f-]{36}$/i.test(otherId)||otherId===req.user.id)return res.status(400).json({error:'Выберите пользователя'});
  const {data:target,error:targetError}=await supabase.from('users').select('id,is_blocked').eq('id',otherId).maybeSingle();
  if(targetError||!target||target.is_blocked)return res.status(404).json({error:'Пользователь не найден'});
  const {data:blocks,error:blockError}=await supabase.from('user_blocks').select('blocker_id').or('and(blocker_id.eq.'+req.user.id+',blocked_id.eq.'+otherId+'),and(blocker_id.eq.'+otherId+',blocked_id.eq.'+req.user.id+')');
  if(blockError)return res.status(500).json({error:'Не удалось проверить ограничения'});
  if(blocks?.length)return res.status(403).json({error:'Нельзя отправить запрос: один из пользователей заблокировал другого'});
  const [a,b]=[req.user.id,otherId].sort();
  const {data:old,error:oldError}=await supabase.from('direct_conversations').select('*').eq('participant_a',a).eq('participant_b',b).maybeSingle();
  if(oldError)return res.status(500).json({error:'Не удалось проверить запрос'});
  if(old?.status==='active')return res.json({conversation:old,alreadyActive:true});
  if(old?.status==='pending')return res.status(409).json({error:old.request_by===req.user.id?'Запрос уже отправлен':'У вас уже есть входящий запрос от этого пользователя',incoming:old.request_by!==req.user.id,conversationId:old.id});
  let conversation,error;
  if(old){
    const updated=await supabase.from('direct_conversations').update({status:'pending',request_by:req.user.id,cleared_at_a:null,cleared_at_b:null,updated_at:new Date().toISOString()}).eq('id',old.id).select('*').single();
    conversation=updated.data;error=updated.error;
  }else{
    const created=await supabase.from('direct_conversations').insert({participant_a:a,participant_b:b,request_by:req.user.id}).select('*').single();
    conversation=created.data;error=created.error;
  }
  if(error)return res.status(400).json({error:'Не удалось отправить запрос на чат'});
  await createNotification(otherId,'Запрос на личный чат',(req.user.full_name||'Пользователь')+' хочет начать с вами переписку.','chat_request','/messages/?conversation='+encodeURIComponent(conversation.id));
  res.status(201).json({conversation});
}));
app.patch('/api/messages/conversations/:id', requireUser, asyncRoute(async(req,res)=>{
  const {data:c,error}=await supabase.from('direct_conversations').select('*').eq('id',req.params.id).maybeSingle();
  if(error)return res.status(500).json({error:'Не удалось загрузить запрос'});
  if(!c||![c.participant_a,c.participant_b].includes(req.user.id))return res.status(404).json({error:'Переписка не найдена'});
  const action=String(req.body.action||'');
  const ownSide=c.participant_a===req.user.id?'a':'b';
  if(action==='accept'||action==='decline'){
    if(c.status!=='pending'||c.request_by===req.user.id)return res.status(409).json({error:'Этот запрос нельзя обработать'});
    const {data:blocks}=await supabase.from('user_blocks').select('blocker_id').or('and(blocker_id.eq.'+c.participant_a+',blocked_id.eq.'+c.participant_b+'),and(blocker_id.eq.'+c.participant_b+',blocked_id.eq.'+c.participant_a+')');
    if(blocks?.length)return res.status(403).json({error:'Чат недоступен из-за блокировки'});
    const result=await supabase.from('direct_conversations').update({status:action==='accept'?'active':'declined',updated_at:new Date().toISOString()}).eq('id',c.id).select('*').single();
    if(result.error)return res.status(400).json({error:'Не удалось сохранить решение'});
    await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:action==='accept'?'CHAT_REQUEST_ACCEPTED':'CHAT_REQUEST_DECLINED',entity_type:'conversation',entity_id:c.id,details:{}});
    await createNotification(c.request_by,action==='accept'?'Запрос на чат принят':'Запрос на чат отклонён',(req.user.full_name||'Пользователь')+(action==='accept'?' принял ваш запрос. Теперь можно переписываться.':' отклонил запрос на личную переписку.'),'chat_request_result','/messages/?conversation='+encodeURIComponent(c.id));
    return res.json({conversation:result.data});
  }
  if(action==='clear'){
    const field=ownSide==='a'?'cleared_at_a':'cleared_at_b';
    const update=await supabase.from('direct_conversations').update({[field]:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',c.id).select('*').single();
    if(update.error)return res.status(400).json({error:'Не удалось очистить историю'});
    const {data:both}=await supabase.from('direct_conversations').select('cleared_at_a,cleared_at_b').eq('id',c.id).maybeSingle();
    if(both?.cleared_at_a&&both?.cleared_at_b){
      await supabase.from('direct_conversations').delete().eq('id',c.id);
      return res.json({cleared:true,deleted:true,clearCount:2});
    }
    return res.json({cleared:true,deleted:false,clearCount:1});
  }
  return res.status(400).json({error:'Неизвестное действие'});
}));
app.get('/api/messages/conversations/:id/messages', requireUser, asyncRoute(async(req,res)=>{
  const {data:c,error}=await supabase.from('direct_conversations').select('*').eq('id',req.params.id).maybeSingle();
  if(error)return res.status(500).json({error:'Не удалось загрузить переписку'});
  if(!c||c.status!=='active'||![c.participant_a,c.participant_b].includes(req.user.id))return res.status(404).json({error:'Переписка не найдена'});
  const {data:blocks}=await supabase.from('user_blocks').select('blocker_id').or('and(blocker_id.eq.'+c.participant_a+',blocked_id.eq.'+c.participant_b+'),and(blocker_id.eq.'+c.participant_b+',blocked_id.eq.'+c.participant_a+')');
  if(blocks?.length)return res.status(403).json({error:'Чат закрыт из-за блокировки'});
  const ownSide=c.participant_a===req.user.id?'a':'b';
   const ownClear=ownSide==='a'?c.cleared_at_a:c.cleared_at_b;
   await supabase.from('direct_conversations').update({[ownSide==='a'?'last_read_at_a':'last_read_at_b']:new Date().toISOString()}).eq('id',c.id);
  let query=supabase.from('direct_messages').select('id,conversation_id,sender_id,body,created_at').eq('conversation_id',c.id);
  if(ownClear)query=query.gt('created_at',ownClear);
  if(req.query.before)query=query.lt('created_at',String(req.query.before));
  const {data,error:messageError}=await query.order('created_at',{ascending:false}).limit(15);
  if(messageError)return res.status(500).json({error:'Не удалось загрузить сообщения'});
  res.json({messages:(data||[]).reverse(),hasMore:(data||[]).length===15,clearCount:Number(Boolean(c.cleared_at_a))+Number(Boolean(c.cleared_at_b))});
}));
app.patch('/api/messages/conversations/:id/read', requireUser, asyncRoute(async(req,res)=>{
  const {data:c,error}=await supabase.from('direct_conversations').select('id,participant_a,participant_b,status').eq('id',req.params.id).maybeSingle();
  if(error)return res.status(500).json({error:'Не удалось обновить статус прочтения'});
  if(!c||c.status!=='active'||![c.participant_a,c.participant_b].includes(req.user.id))return res.status(404).json({error:'Переписка не найдена'});
  const field=c.participant_a===req.user.id?'last_read_at_a':'last_read_at_b';
  const {error:updateError}=await supabase.from('direct_conversations').update({[field]:new Date().toISOString()}).eq('id',c.id);
  if(updateError)return res.status(400).json({error:'Не удалось отметить сообщения прочитанными'});
  res.json({success:true});
}));
app.post('/api/messages/conversations/:id/messages', requireUser, asyncRoute(async(req,res)=>{
  const body=String(req.body.body||'').trim();
  if(!body||body.length>512)return res.status(400).json({error:'Сообщение должно содержать от 1 до 512 символов'});
  const {data:c,error}=await supabase.from('direct_conversations').select('*').eq('id',req.params.id).maybeSingle();
  if(error)return res.status(500).json({error:'Не удалось загрузить переписку'});
  if(!c||c.status!=='active'||![c.participant_a,c.participant_b].includes(req.user.id))return res.status(403).json({error:'Сначала дождитесь подтверждения запроса'});
  const {data:blocks}=await supabase.from('user_blocks').select('blocker_id').or('and(blocker_id.eq.'+c.participant_a+',blocked_id.eq.'+c.participant_b+'),and(blocker_id.eq.'+c.participant_b+',blocked_id.eq.'+c.participant_a+')');
  if(blocks?.length)return res.status(403).json({error:'Сообщение не отправлено: пользователь заблокирован'});
  const {data,error:messageError}=await supabase.from('direct_messages').insert({conversation_id:c.id,sender_id:req.user.id,body}).select('*').single();
  if(messageError)return res.status(400).json({error:'Не удалось отправить сообщение'});
  await supabase.from('direct_conversations').update({updated_at:new Date().toISOString()}).eq('id',c.id);
  const recipientId=c.participant_a===req.user.id?c.participant_b:c.participant_a;
  await createNotification(recipientId,'Новое личное сообщение',(req.user.full_name||'Пользователь')+': '+body.slice(0,180),'direct_message','/messages/?conversation='+encodeURIComponent(c.id));
  res.status(201).json({message:data});
}));
app.post('/api/me/blocks/:id', requireUser, asyncRoute(async(req,res)=>{
  if(req.params.id===req.user.id)return res.status(400).json({error:'Нельзя заблокировать себя'});
  const {data:target}=await supabase.from('users').select('id,is_blocked').eq('id',req.params.id).maybeSingle();
  if(!target||target.is_blocked)return res.status(404).json({error:'Пользователь не найден'});
  const {error}=await supabase.from('user_blocks').upsert({blocker_id:req.user.id,blocked_id:target.id},{onConflict:'blocker_id,blocked_id'});
  if(error)return res.status(400).json({error:'Не удалось заблокировать пользователя'});
  await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:'USER_BLOCKED_BY_USER',entity_type:'user',entity_id:target.id,details:{}});
  res.json({blocked:true});
}));
app.delete('/api/me/blocks/:id', requireUser, asyncRoute(async(req,res)=>{
  const {error}=await supabase.from('user_blocks').delete().eq('blocker_id',req.user.id).eq('blocked_id',req.params.id);
  if(error)return res.status(400).json({error:'Не удалось снять блокировку'});
  res.json({blocked:false});
}));
app.get('/api/me/blocks', requireUser, asyncRoute(async(req,res)=>{
  const {data,error}=await supabase.from('user_blocks').select('blocked_id,users!user_blocks_blocked_id_fkey(id,full_name,username,avatar_url,avatar_path)').eq('blocker_id',req.user.id);
  if(error)return res.status(500).json({error:'Не удалось загрузить список блокировок'});
  const users=await Promise.all((data||[]).map(x=>signedUserAvatar(x.users)));
  res.json({blocks:(data||[]).map(x=>x.blocked_id),users});
}));

app.get('/api/admin/profile-links', requireUser, requireRootAdmin, asyncRoute(async(req,res)=>{
  const offset=Math.max(0,parseInt(req.query.offset||'0',10)||0),status=String(req.query.status||'pending');
  if(!['pending','approved','rejected'].includes(status))return res.status(400).json({error:'Некорректный статус'});
  const {data,error}=await supabase.from('profile_links').select('id,user_id,url,platform,status,created_at,users!profile_links_user_id_fkey(id,full_name,username,avatar_url,avatar_path,role)').eq('status',status).order('created_at',{ascending:true}).range(offset,offset+10);
  if(error)return res.status(500).json({error:'Не удалось загрузить ссылки на модерацию'});
  const items=await Promise.all((data||[]).slice(0,10).map(async item=>({...item,users:await signedUserAvatar(item.users)})));
  res.json({links:items,hasMore:(data||[]).length>10,offset});
}));
app.patch('/api/admin/profile-links/:id', requireUser, requireRootAdmin, asyncRoute(async(req,res)=>{
  const status=String(req.body.status||'');
  if(!['approved','rejected'].includes(status))return res.status(400).json({error:'Выберите решение модерации'});
  const {data,error}=await supabase.from('profile_links').update({status,moderated_by:req.user.id,moderated_at:new Date().toISOString()}).eq('id',req.params.id).eq('status','pending').select('id,user_id,status').maybeSingle();
  if(error)return res.status(400).json({error:'Не удалось сохранить решение'});
  if(!data)return res.status(404).json({error:'Запрос не найден'});
  await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:status==='approved'?'PROFILE_LINK_APPROVED':'PROFILE_LINK_REJECTED',entity_type:'profile_link',entity_id:data.id,details:{user_id:data.user_id}});
  await createNotification(data.user_id,status==='approved'?'Ссылка опубликована':'Ссылка отклонена',status==='approved'?'Главный администратор одобрил ссылку — она появилась в вашем профиле.':'Главный администратор отклонил ссылку. Вы можете отправить другую.','profile_link_result');
  res.json({link:data});
}));
app.get('/api/admin/users/:id/profile', requireUser, requireRootAdmin, asyncRoute(async(req,res)=>{
  const [{data:authResult,error:authError},{data:profile,error},{data:wallet,error:walletError},{data:links,error:linksError}]=await Promise.all([
    supabase.auth.admin.getUserById(req.params.id),
    supabase.from('users').select('id,email,full_name,username,phone,city,avatar_url,avatar_path,role,is_blocked,preferences,created_at').eq('id',req.params.id).maybeSingle(),
    supabase.from('wallet_accounts').select('balance').eq('user_id',req.params.id).maybeSingle(),
    supabase.from('profile_links').select('id,url,platform,status,created_at,moderated_at').eq('user_id',req.params.id).order('created_at',{ascending:false})
  ]);
  if(authError||error||walletError||linksError)return res.status(500).json({error:'Не удалось загрузить данные аккаунта'});
  if(!authResult?.user||!profile)return res.status(404).json({error:'Аккаунт не найден'});
  const response=await signedUserAvatar({...profile,about:profile.preferences?.about||'',balance:Number(wallet?.balance||0),links:links||[],email:authResult.user.email,is_root_admin:isRootEmail(authResult.user.email)});
  res.json({profile:response});
}));
app.patch('/api/admin/users/:id/profile', requireUser, requireRootAdmin, asyncRoute(async(req,res)=>{
  const fields={};
  if(req.body.full_name!==undefined)fields.full_name=String(req.body.full_name).trim().slice(0,120);
  if(req.body.username!==undefined){const username=String(req.body.username).trim().toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(username))return res.status(400).json({error:'Юзернейм: 3–24 символа, латинские буквы, цифры и _'});fields.username=username}
  if(req.body.phone!==undefined)fields.phone=String(req.body.phone).trim().slice(0,40)||null;
  if(req.body.city!==undefined)fields.city=String(req.body.city).trim().slice(0,100)||null;
  if(req.body.avatar_url!==undefined)fields.avatar_url=String(req.body.avatar_url).trim().slice(0,1000)||null;
  if(req.body.about!==undefined){const {data:old}=await supabase.from('users').select('preferences').eq('id',req.params.id).maybeSingle();fields.preferences={...(old?.preferences||{}),about:String(req.body.about).trim().slice(0,1000)}}
  const {data,error}=await supabase.from('users').update(fields).eq('id',req.params.id).select('id,full_name,username,phone,city,avatar_url,preferences').maybeSingle();
  if(error?.code==='23505')return res.status(409).json({error:'Этот юзернейм уже занят'});
  if(error)return res.status(400).json({error:'Не удалось сохранить профиль'});
  if(!data)return res.status(404).json({error:'Аккаунт не найден'});
  if(req.body.avatarData){
    const match=String(req.body.avatarData).match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
    if(!match)return res.status(400).json({error:'Аватар должен быть PNG, JPEG или WebP'});
    const bytes=Buffer.from(match[2],'base64');if(bytes.length>2*1024*1024)return res.status(413).json({error:'Максимальный размер аватара — 2 МБ'});
    const ext=match[1].split('/')[1].replace('jpeg','jpg'),path=req.params.id+'/admin-'+Date.now()+'.'+ext;
    const upload=await supabase.storage.from('avatars').upload(path,bytes,{contentType:match[1],upsert:true});
    if(upload.error)return res.status(400).json({error:'Не удалось загрузить аватар'});
    const avatarUpdate=await supabase.from('users').update({avatar_path:path,avatar_url:null}).eq('id',req.params.id);
    if(avatarUpdate.error)return res.status(400).json({error:'Аватар загружен, но профиль не обновлён'});
  }
  await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:'ADMIN_PROFILE_UPDATED',entity_type:'user',entity_id:req.params.id,details:{fields:Object.keys(fields)}});
  res.json({profile:data});
}));
app.post('/api/admin/users/:id/balance-adjustments', requireUser, requireRootAdmin, asyncRoute(async(req,res)=>{
  const amount=Number(req.body.amount),note=String(req.body.note||'').trim().slice(0,240)||'Корректировка баланса администратором';
  if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>100000000)return res.status(400).json({error:'Укажите сумму изменения баланса'});
  const {data,error}=await supabase.rpc('admin_adjust_wallet',{p_user_id:req.params.id,p_amount:amount,p_actor_id:req.user.id,p_note:note});
  if(error)return res.status(400).json({error:error.message.includes('insufficient_balance')?'Списание превышает баланс':'Не удалось изменить баланс'});
  await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:'ADMIN_WALLET_ADJUSTED',entity_type:'user',entity_id:req.params.id,details:{amount,note}});
  res.json({balance:Number(data)});
}));
app.delete('/api/admin/profile-links/:id', requireUser, requireRootAdmin, asyncRoute(async(req,res)=>{
  const {data,error}=await supabase.from('profile_links').delete().eq('id',req.params.id).select('id').maybeSingle();
  if(error)return res.status(400).json({error:'Не удалось удалить ссылку'});
  if(!data)return res.status(404).json({error:'Ссылка не найдена'});
  await supabase.from('audit_logs').insert({actor_id:req.user.id,actor_name:req.user.full_name,action:'ADMIN_PROFILE_LINK_DELETED',entity_type:'profile_link',entity_id:data.id,details:{}});
  res.json({deleted:true});
}));

app.use((err, _req, res, _next) => {
  console.error('[api]', err.message);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

async function purgeDirectMessages() {
  if (!supabase) return;
  try { const { data, error } = await supabase.rpc('purge_direct_message_data'); if (error) throw error; if (data?.messages_deleted || data?.conversations_deleted) console.log('[message-retention] cleanup', data); } catch (error) { console.error('[message-retention] cleanup failed:', error.message); }
}
async function purgeExpiredPaymentIntents() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.rpc('expire_payment_intents');
    if (error) throw error;
    if (Number(data) > 0) console.log('[payment-retention] expired ' + Number(data) + ' unpaid intents and released reserved seats');
  } catch (error) {
    console.error('[payment-retention] expiration failed:', error.message);
  }
}
async function purgeExpiredUsedTickets() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.rpc('purge_used_tickets_after_week', { p_batch_size: 100 });
    if (error) throw error;
    if (Number(data) > 0) console.log('[ticket-retention] deleted ' + Number(data) + ' used tickets past retention');
  } catch (error) {
    console.error('[ticket-retention] cleanup failed:', error.message);
  }
}
app.listen(port, '0.0.0.0', () => console.log('FlowTix API listening on ' + port));
void purgeExpiredUsedTickets();
void purgeExpiredPaymentIntents();
void purgeDirectMessages();
setInterval(purgeDirectMessages, 60 * 60 * 1000).unref();
setInterval(purgeExpiredUsedTickets, 60 * 60 * 1000).unref();
setInterval(purgeExpiredPaymentIntents, 60 * 1000).unref();
const pingUrl = process.env.RENDER_EXTERNAL_URL;
if (pingUrl) {
  setInterval(() => {
    fetch(pingUrl.replace(/\/$/, '') + '/api/health')
      .then((response) => console.log('[keepalive] health ping ' + response.status))
      .catch((error) => console.error('[keepalive] failed:', error.message));
  }, 14 * 60 * 1000).unref();
}
