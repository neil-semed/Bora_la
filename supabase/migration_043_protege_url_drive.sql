-- Bora Lá | Proteção da URL do endpoint de upload do Google Drive.

create or replace function public.guard_drive_upload_url()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.key = 'drive_upload_url'
    and coalesce(current_setting('bora.allow_drive_url_change', true), '') <> 'yes' then
    raise exception 'A URL do Google Drive está protegida. Use a alteração confirmada na tela Cooperativas.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_drive_upload_url on public.app_settings;
create trigger trg_guard_drive_upload_url before update on public.app_settings
  for each row execute function public.guard_drive_upload_url();

create or replace function public.set_drive_upload_url(p_value text, p_confirmation text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'admin' then raise exception 'Somente administradores podem alterar a URL do Drive.'; end if;
  if p_confirmation <> 'ALTERAR DRIVE' then raise exception 'Confirmação inválida para alteração da URL do Drive.'; end if;
  perform set_config('bora.allow_drive_url_change', 'yes', true);
  insert into public.app_settings(key, value) values ('drive_upload_url', trim(coalesce(p_value, '')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

revoke all on function public.set_drive_upload_url(text, text) from public;
grant execute on function public.set_drive_upload_url(text, text) to authenticated;
