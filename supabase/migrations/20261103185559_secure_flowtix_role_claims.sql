update auth.users as auth_user
set raw_app_meta_data =
  coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'flowtix_role',
    case
      when coalesce(profile.role::text, 'visitor') = 'admin' then 'visitor'
      when coalesce(profile.role::text, 'visitor') in ('visitor','organizer','staff','moderator') then profile.role::text
      else 'visitor'
    end,
    'flowtix_blocked', coalesce(profile.is_blocked, false)
  )
from public.users as profile
where profile.id = auth_user.id;
