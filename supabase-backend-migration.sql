-- PreClean: migracion aditiva para revision y ejecucion MANUAL.
-- No ejecutar hasta confirmar los tipos reales de profiles/site_content y auditar
-- todas las politicas existentes. Las policies permisivas de Postgres se combinan
-- con OR; no se eliminan policies antiguas automaticamente.
-- Supuesto: profiles(id uuid, role text); site_content(content_key text UNIQUE,
-- title text, content text, is_published boolean, updated_at timestamptz,
-- updated_by uuid). Si difiere, adaptar preclean_review_submission primero.
-- PRECHECK (ejecutar por separado):
-- select table_name,column_name,data_type from information_schema.columns
-- where table_schema='public' and table_name in ('profiles','site_content');
-- select * from pg_policies where schemaname in ('public','storage');

create or replace function public.preclean_role() returns text
language sql stable security definer set search_path = ''
as $$ select coalesce((select p.role from public.profiles p where p.id=(select auth.uid())), '') $$;
create or replace function public.preclean_is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.preclean_role()='admin' $$;
create or replace function public.preclean_has_content_access() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.preclean_role() in ('admin','editor') $$;
revoke all on function public.preclean_role() from public, anon;
revoke all on function public.preclean_is_admin() from public, anon;
revoke all on function public.preclean_has_content_access() from public, anon;
grant execute on function public.preclean_role() to authenticated;
grant execute on function public.preclean_is_admin() to authenticated;
grant execute on function public.preclean_has_content_access() to authenticated;
-- Policies for public SELECT can evaluate the boolean helpers; they return false
-- for anonymous visitors and never return the role string itself.
grant execute on function public.preclean_is_admin() to anon;
grant execute on function public.preclean_has_content_access() to anon;

create table if not exists public.content_submissions (
 id uuid primary key default gen_random_uuid(), content_key text not null,
 payload jsonb not null check (jsonb_typeof(payload)='object'),
 status text not null default 'draft' check(status in ('draft','pending','approved','rejected')),
 created_by uuid not null references public.profiles(id) on delete restrict,
 reviewed_by uuid references public.profiles(id) on delete set null,
 review_note text, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), reviewed_at timestamptz,
 check(content_key ~ '^[a-z0-9_-]{1,80}$')
);
create index if not exists content_submissions_owner_idx on public.content_submissions(created_by,status,updated_at desc);
create index if not exists content_submissions_review_idx on public.content_submissions(status,created_at) where status='pending';

create table if not exists public.testimonials (
 id uuid primary key default gen_random_uuid(),
 author text not null check(char_length(btrim(author)) between 1 and 80),
 quote text not null check(char_length(btrim(quote)) between 1 and 800),
 status text not null default 'draft' check(status in ('draft','pending','published','rejected')),
 created_by uuid not null references public.profiles(id) on delete restrict,
 reviewed_by uuid references public.profiles(id) on delete set null,
 review_note text, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), reviewed_at timestamptz
);
create index if not exists testimonials_public_idx on public.testimonials(created_at desc) where status='published';
create index if not exists testimonials_owner_idx on public.testimonials(created_by,updated_at desc);

create table if not exists public.media_assets (
 id uuid primary key default gen_random_uuid(), content_key text not null,
 kind text not null check(kind in ('image','video')),
 draft_path text not null unique, public_path text unique,
 original_name text not null check(char_length(original_name) between 1 and 255),
 mime_type text not null, size_bytes bigint not null check(size_bytes>0),
 status text not null default 'draft' check(status in ('draft','pending','published','rejected')),
 created_by uuid not null references public.profiles(id) on delete restrict,
 reviewed_by uuid references public.profiles(id) on delete set null,
 review_note text, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), reviewed_at timestamptz,
 check(content_key ~ '^[a-z0-9_-]{1,80}$'),
 check((kind='image' and mime_type in ('image/jpeg','image/png','image/webp')) or (kind='video' and mime_type in ('video/mp4','video/webm'))),
 check(size_bytes <= case when kind='image' then 10485760 else 104857600 end)
);
create index if not exists media_assets_owner_idx on public.media_assets(created_by,status,updated_at desc);
create index if not exists media_assets_public_idx on public.media_assets(content_key,created_at desc) where status='published';

alter table public.content_submissions enable row level security;
alter table public.testimonials enable row level security;
alter table public.media_assets enable row level security;
create policy preclean_submissions_read on public.content_submissions for select to authenticated
 using(public.preclean_is_admin() or created_by=(select auth.uid()));
create policy preclean_submissions_insert on public.content_submissions for insert to authenticated
 with check(public.preclean_has_content_access() and created_by=(select auth.uid()) and status in ('draft','pending'));
create policy preclean_submissions_edit on public.content_submissions for update to authenticated
 using(public.preclean_is_admin() or (created_by=(select auth.uid()) and status='draft'))
 with check(public.preclean_is_admin() or (created_by=(select auth.uid()) and status in ('draft','pending')));
create policy preclean_submissions_delete on public.content_submissions for delete to authenticated using(public.preclean_is_admin());

create policy preclean_testimonials_read on public.testimonials for select to anon,authenticated
 using(status='published' or (auth.uid() is not null and (public.preclean_is_admin() or created_by=(select auth.uid()))));
create policy preclean_testimonials_insert on public.testimonials for insert to authenticated
 with check(public.preclean_has_content_access() and created_by=(select auth.uid()) and status in ('draft','pending'));
create policy preclean_testimonials_edit on public.testimonials for update to authenticated
 using(public.preclean_is_admin() or (created_by=(select auth.uid()) and status='draft'))
 with check(public.preclean_is_admin() or (created_by=(select auth.uid()) and status in ('draft','pending')));
create policy preclean_testimonials_delete on public.testimonials for delete to authenticated using(public.preclean_is_admin());
create policy preclean_testimonials_delete_own_draft on public.testimonials for delete to authenticated
 using(created_by=(select auth.uid()) and status='draft');

create policy preclean_media_read on public.media_assets for select to anon,authenticated
 using(status='published' or (auth.uid() is not null and (public.preclean_is_admin() or created_by=(select auth.uid()))));
create policy preclean_media_insert on public.media_assets for insert to authenticated
 with check(public.preclean_has_content_access() and created_by=(select auth.uid()) and status in ('draft','pending'));
create policy preclean_media_edit on public.media_assets for update to authenticated
 using(public.preclean_is_admin() or (created_by=(select auth.uid()) and status='draft'))
 with check(public.preclean_is_admin() or (created_by=(select auth.uid()) and status in ('draft','pending')));
create policy preclean_media_delete on public.media_assets for delete to authenticated using(public.preclean_is_admin());
create policy preclean_media_delete_own_draft on public.media_assets for delete to authenticated
 using(created_by=(select auth.uid()) and status='draft');

create or replace function public.preclean_review_submission(p_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=''
as $$
declare s public.content_submissions%rowtype;
begin
 if not public.preclean_is_admin() then raise exception 'admin_required'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
 select * into s from public.content_submissions where id=p_id for update;
 if not found or s.status<>'pending' then raise exception 'submission_not_pending'; end if;
 if p_decision='approved' then
  insert into public.site_content(content_key,title,content,is_published,updated_at,updated_by)
  values(s.content_key,coalesce(s.payload->>'title',''),coalesce(s.payload->>'body',''),true,now(),(select auth.uid()))
  on conflict(content_key) do update set title=excluded.title,content=excluded.content,
   is_published=true,updated_at=now(),updated_by=(select auth.uid());
 end if;
 update public.content_submissions set status=p_decision,reviewed_by=(select auth.uid()),
  reviewed_at=now(),review_note=p_note,updated_at=now() where id=p_id;
end $$;

create or replace function public.preclean_review_testimonial(p_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=''
as $$ begin
 if not public.preclean_is_admin() then raise exception 'admin_required'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
 update public.testimonials set status=case when p_decision='approved' then 'published' else 'rejected' end,
  reviewed_by=(select auth.uid()),reviewed_at=now(),review_note=p_note,updated_at=now()
  where id=p_id and status='pending';
 if not found then raise exception 'testimonial_not_pending'; end if;
end $$;

create or replace function public.preclean_review_media(p_id uuid,p_decision text,p_public_path text default null,p_note text default null)
returns void language plpgsql security definer set search_path=''
as $$ begin
 if not public.preclean_is_admin() then raise exception 'admin_required'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
 if p_decision='approved' and coalesce(p_public_path,'')='' then raise exception 'public_path_required'; end if;
 update public.media_assets set status=case when p_decision='approved' then 'published' else 'rejected' end,
  public_path=case when p_decision='approved' then p_public_path else null end,
  reviewed_by=(select auth.uid()),reviewed_at=now(),review_note=p_note,updated_at=now()
  where id=p_id and status='pending';
 if not found then raise exception 'media_not_pending'; end if;
end $$;
revoke all on function public.preclean_review_submission(uuid,text,text) from public,anon;
revoke all on function public.preclean_review_testimonial(uuid,text,text) from public,anon;
revoke all on function public.preclean_review_media(uuid,text,text,text) from public,anon;
grant execute on function public.preclean_review_submission(uuid,text,text) to authenticated;
grant execute on function public.preclean_review_testimonial(uuid,text,text) to authenticated;
grant execute on function public.preclean_review_media(uuid,text,text,text) to authenticated;

create or replace function public.preclean_set_role(p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path=''
as $$ begin
 if not public.preclean_is_admin() then raise exception 'admin_required'; end if;
 if p_role not in ('admin','editor') then raise exception 'invalid_role'; end if;
 update public.profiles set role=p_role where id=p_user_id;
 if not found then raise exception 'profile_not_found'; end if;
end $$;
revoke all on function public.preclean_set_role(uuid,text) from public,anon;
grant execute on function public.preclean_set_role(uuid,text) to authenticated;

-- Site content is public-read for published rows. The new content editor's direct
-- upsert is admin-only; editors submit to content_submissions instead.
alter table public.site_content enable row level security;
create policy preclean_site_content_public_read on public.site_content for select to anon,authenticated
 using(is_published=true or (auth.uid() is not null and public.preclean_is_admin()));
create policy preclean_site_content_admin_insert on public.site_content for insert to authenticated
 with check(public.preclean_is_admin());
create policy preclean_site_content_admin_update on public.site_content for update to authenticated
 using(public.preclean_is_admin()) with check(public.preclean_is_admin());
create policy preclean_site_content_admin_delete on public.site_content for delete to authenticated
 using(public.preclean_is_admin());
-- Restrictive guards also constrain any older permissive policies on this table.
create policy preclean_site_content_select_guard on public.site_content as restrictive for select to public
 using(is_published=true or (auth.uid() is not null and public.preclean_is_admin()));
create policy preclean_site_content_insert_guard on public.site_content as restrictive for insert to authenticated
 with check(public.preclean_is_admin());
create policy preclean_site_content_update_guard on public.site_content as restrictive for update to authenticated
 using(public.preclean_is_admin()) with check(public.preclean_is_admin());
create policy preclean_site_content_delete_guard on public.site_content as restrictive for delete to authenticated
 using(public.preclean_is_admin());

grant select on public.content_submissions,public.testimonials,public.media_assets to anon,authenticated;
grant insert,update,delete on public.content_submissions,public.testimonials,public.media_assets to authenticated;
grant select on public.site_content to anon,authenticated;
grant insert,update,delete on public.site_content to authenticated;
grant select on public.profiles to authenticated;
revoke update on public.profiles from public,anon,authenticated;
create policy preclean_profiles_self_read on public.profiles for select to authenticated
 using(id=(select auth.uid()));
create policy preclean_profiles_admin_read on public.profiles for select to authenticated
 using(public.preclean_is_admin());
create policy preclean_profiles_select_guard on public.profiles as restrictive for select to public
 using(auth.uid() is not null and (id=(select auth.uid()) or public.preclean_is_admin()));

-- STORAGE: al ejecutar esta migracion se crean los buckets y policies con nombres
-- propios. Revisar policies previas antes: policies permisivas se combinan por OR.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('preclean-drafts','preclean-drafts',false,104857600,array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('preclean-media','preclean-media',true,104857600,array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict(id) do nothing;
create policy preclean_drafts_select on storage.objects for select to authenticated
 using(bucket_id='preclean-drafts' and (owner_id=(select auth.uid())::text or public.preclean_is_admin()));
create policy preclean_drafts_insert on storage.objects for insert to authenticated
 with check(bucket_id='preclean-drafts' and (storage.foldername(name))[1]=(select auth.uid())::text and public.preclean_has_content_access());
create policy preclean_drafts_update on storage.objects for update to authenticated
 using(bucket_id='preclean-drafts' and public.preclean_is_admin())
 with check(bucket_id='preclean-drafts' and public.preclean_is_admin());
create policy preclean_drafts_delete on storage.objects for delete to authenticated
 using(bucket_id='preclean-drafts' and (public.preclean_is_admin() or
  (owner_id=(select auth.uid())::text and not exists(
   select 1 from public.media_assets m where m.draft_path=name and m.status<>'draft'))));
create policy preclean_media_public_read on storage.objects for select to public using(bucket_id='preclean-media');
create policy preclean_media_admin_insert on storage.objects for insert to authenticated
 with check(bucket_id='preclean-media' and public.preclean_is_admin());
create policy preclean_media_admin_update on storage.objects for update to authenticated
 using(bucket_id='preclean-media' and public.preclean_is_admin()) with check(bucket_id='preclean-media' and public.preclean_is_admin());
create policy preclean_media_admin_delete on storage.objects for delete to authenticated
 using(bucket_id='preclean-media' and public.preclean_is_admin());
-- Restrictive bucket-scoped guards prevent an older permissive policy from
-- granting wider access to these two buckets without affecting other buckets.
create policy preclean_bucket_select_guard on storage.objects as restrictive for select to public
 using(bucket_id not in ('preclean-drafts','preclean-media') or bucket_id='preclean-media' or
  (bucket_id='preclean-drafts' and auth.uid() is not null and
   (owner_id=(select auth.uid())::text or public.preclean_is_admin())));
create policy preclean_bucket_insert_guard on storage.objects as restrictive for insert to public
 with check(bucket_id not in ('preclean-drafts','preclean-media') or
  (bucket_id='preclean-drafts' and auth.uid() is not null and (storage.foldername(name))[1]=(select auth.uid())::text and public.preclean_has_content_access()) or
  (bucket_id='preclean-media' and auth.uid() is not null and public.preclean_is_admin()));
create policy preclean_bucket_update_guard on storage.objects as restrictive for update to public
 using(bucket_id not in ('preclean-drafts','preclean-media') or
  (bucket_id in ('preclean-drafts','preclean-media') and public.preclean_is_admin()))
 with check(bucket_id not in ('preclean-drafts','preclean-media') or
  (bucket_id in ('preclean-drafts','preclean-media') and public.preclean_is_admin()));
create policy preclean_bucket_delete_guard on storage.objects as restrictive for delete to public
 using(bucket_id not in ('preclean-drafts','preclean-media') or
  (bucket_id='preclean-media' and public.preclean_is_admin()) or
  (bucket_id='preclean-drafts' and (public.preclean_is_admin() or
   (auth.uid() is not null and owner_id=(select auth.uid())::text and not exists(
    select 1 from public.media_assets m where m.draft_path=name and m.status<>'draft')))));
-- La app descarga el objeto borrador y lo vuelve a subir al bucket publico como
-- admin; si la RPC de aprobacion falla, elimina el archivo publico huerfano.
--
-- PERFIL: esta migracion nunca acepta role desde signup. Auditar trigger actual;
-- debe asignar rol basico. Revocar a authenticated UPDATE sobre profiles.role;
-- si hay GRANT de tabla completa, revocar UPDATE de tabla y conceder solo las
-- columnas editables necesarias. No borrar ni reemplazar policies existentes
-- hasta verificar su efecto. RLS de profiles debe negar autoescalada.
