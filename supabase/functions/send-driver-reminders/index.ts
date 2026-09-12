// Deve ser chamada por um agendador a cada hora. Cria uma única notificação, cerca
// de 24 h antes, para cada motorista escalado em viagem confirmada pelo Admin.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected || req.headers.get('x-cron-secret') !== expected) return json({ error: 'Não autorizado.' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = new Date();
  const { data: trips, error } = await admin.from('excursions')
    .select('id,trip_date,departure_time,destination,status,situacao,driver_reminder_24h_sent_at,excursion_drivers(driver_id)')
    .eq('status', 'approved').is('driver_reminder_24h_sent_at', null)
    .not('situacao', 'in', '(cancelada,reprovada)');
  if (error) return json({ error: error.message }, 500);
  let sent = 0;
  for (const trip of trips || []) {
    const departure = new Date(`${trip.trip_date}T${String(trip.departure_time).slice(0, 5)}:00-03:00`);
    const hours = (departure.getTime() - now.getTime()) / 3600000;
    if (hours < 23 || hours > 25) continue;
    const driverIds = (trip.excursion_drivers || []).map((x: { driver_id: string }) => x.driver_id).filter(Boolean);
    if (!driverIds.length) continue;
    const { data: profiles } = await admin.from('profiles').select('id').eq('role', 'motorista').eq('active', true).in('driver_id', driverIds);
    const date = new Date(`${trip.trip_date}T00:00:00-03:00`).toLocaleDateString('pt-BR');
    if (profiles?.length) await admin.from('notifications').insert(profiles.map((p) => ({ user_id: p.id, excursion_id: trip.id, title: 'Lembrete de viagem', message: `Sua viagem para ${trip.destination || '-'} sai amanhã, ${date}, às ${String(trip.departure_time).slice(0, 5)}.` })));
    await admin.from('excursions').update({ driver_reminder_24h_sent_at: new Date().toISOString() }).eq('id', trip.id);
    sent += 1;
  }
  return json({ ok: true, processed: sent });
});
