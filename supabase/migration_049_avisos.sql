-- ============================================================
-- BORA LÁ - migration_049: Avisos administrativos (tela Avisos e "Enviar aviso" na Agenda)
-- Seguro rodar mais de uma vez.
-- ============================================================

-- Campos do aviso na tabela de notificações (sino + janela sobre a tela).
alter table public.notifications add column if not exists notification_type text;
alter table public.notifications add column if not exists priority text not null default 'normal';
alter table public.notifications add column if not exists show_overlay boolean not null default false;
alter table public.notifications add column if not exists sent_by uuid;
alter table public.notifications add column if not exists aviso_id uuid;
alter table public.notifications drop constraint if exists notifications_priority_check;
alter table public.notifications add constraint notifications_priority_check check (priority in ('normal', 'importante'));
create index if not exists notifications_aviso_idx on public.notifications(notification_type, created_at desc) where notification_type = 'aviso_admin';

-- Tela "Avisos" no catálogo de perfis de acesso (Co_Admin envia).
alter table public.access_profile_permissions drop constraint if exists access_profile_permissions_screen_key_check;
alter table public.access_profile_permissions add constraint access_profile_permissions_screen_key_check
  check (screen_key in ('dashboard', 'pendencias', 'agenda', 'solicitacao', 'relatorios', 'validacoes', 'km', 'veiculos', 'motoristas', 'cooperativas', 'unidades', 'validadores', 'carrosolicitacoes', 'carronova', 'ajuda', 'avisos'));
insert into public.access_profile_permissions (access_profile_id, screen_key, can_view, can_edit)
select ap.id, 'avisos', true, true from public.access_profiles ap
where ap.name = 'Co_Admin'
  and not exists (select 1 from public.access_profile_permissions pp where pp.access_profile_id = ap.id and pp.screen_key = 'avisos');

-- Envio: Admin ou perfil com "Avisos · editar". Uma notificação por destinatário, mesmo aviso_id.
create or replace function public.enviar_aviso(
  p_user_ids uuid[], p_titulo text, p_mensagem text,
  p_prioridade text default 'normal', p_sobre_tela boolean default true, p_excursion_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid();
begin
  if not (public.current_role_name() = 'admin' or public.has_access_permission('avisos', true)) then
    raise exception 'Sem permissão para enviar avisos.';
  end if;
  if coalesce(trim(p_titulo), '') = '' or coalesce(trim(p_mensagem), '') = '' then
    raise exception 'Informe o título e a mensagem.';
  end if;
  insert into public.notifications (user_id, excursion_id, title, message, notification_type, priority, show_overlay, sent_by, aviso_id)
  select distinct p.id, p_excursion_id, trim(p_titulo), trim(p_mensagem), 'aviso_admin',
         case when p_prioridade = 'importante' then 'importante' else 'normal' end,
         coalesce(p_sobre_tela, false), auth.uid(), v_id
  from public.profiles p
  where p.id = any(p_user_ids) and p.active is not false;
  return v_id;
end;
$$;
revoke all on function public.enviar_aviso(uuid[], text, text, text, boolean, uuid) from public;
grant execute on function public.enviar_aviso(uuid[], text, text, text, boolean, uuid) to authenticated;

-- Histórico "Avisos enviados": Admin e perfis com a tela Avisos leem os avisos de todos.
drop policy if exists notifications_select_avisos_enviados on public.notifications;
create policy notifications_select_avisos_enviados on public.notifications for select
  using (notification_type = 'aviso_admin' and (public.current_role_name() = 'admin' or public.has_access_permission('avisos', false)));

-- Conferir: select policyname, cmd from pg_policies where tablename = 'notifications';
