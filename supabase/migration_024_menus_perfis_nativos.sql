-- Bora Lá | Menus configuráveis dos perfis nativos
-- Execute uma vez no SQL Editor do Supabase.

create table if not exists public.role_screen_permissions (
  role text not null check (role in ('escola','pedagogia','motorista','agente_externo')),
  screen_key text not null,
  can_view boolean not null default true,
  primary key (role, screen_key)
);

alter table public.role_screen_permissions enable row level security;
drop policy if exists "role_screen_permissions_select_authenticated" on public.role_screen_permissions;
create policy "role_screen_permissions_select_authenticated" on public.role_screen_permissions
  for select using (auth.role() = 'authenticated');
drop policy if exists "role_screen_permissions_write_admin" on public.role_screen_permissions;
create policy "role_screen_permissions_write_admin" on public.role_screen_permissions
  for all using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');
