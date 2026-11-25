-- =============================================================================
-- FUSEAUX : TOUS LES PAYS, DEPUIS LA BASE OFFICIELLE — 13/11/2026 (sa demande)
-- NE MODIFIE AUCUN PAYS EXISTANT. Remplace la liste faite à la main (22 pays, sinon UTC).
-- =============================================================================
--
-- AVANT (reaffectation_delai.sql, 13/11) : fuseau_du_pays connaissait 22 codes à
-- la main ; tout autre code recevait UTC, en silence — l'horloge de
-- réaffectation se décalait de 1 à 3 heures sans que personne le voie.
--
-- APRÈS :
--   · fuseaux_du_pays(code) : TOUS les fuseaux d'un pays, d'après la base
--     officielle des fuseaux (IANA tz, zone.tab, version 2026c, 247 pays) —
--     GÉNÉRÉE, la même liste que lib/fuseauxPays.mjs (test_fuseaux_pays.mjs
--     vérifie qu'elles disent la même chose) ;
--   · fuseau_du_pays(code) : LE fuseau quand le pays n'en a qu'un, sinon rien ;
--   · le garde-fou des pays (pays_fuseau) :
--       - fuseau vide → celui du pays s'il n'y en a qu'un ;
--         pays à plusieurs fuseaux → REFUSÉ, il faut choisir (le message les nomme) ;
--         code inconnu → REFUSÉ (plus jamais UTC en silence) ;
--       - fuseau donné → il doit exister ; et pour un code connu, être un des
--         fuseaux de CE pays (Africa/Luanda pour le Mali : refusé).
--   Les pays existants ne bougent pas (le garde-fou ne joue qu'à la création ou
--   quand le code / le fuseau changent).
--
-- REPRISE (règle des fichiers, §8) : fuseau_du_pays et pays_fuseau
-- (reaffectation_delai.sql) — marquées « fichier: fuseaux_pays.sql » ;
-- reaffectation_delai.sql les garde (notice « gardée »).
--
--   §1 prérequis ; §2 la liste ; §3 le garde-fou ; §4 contrôles ; §5 répétition (annulée).
--
-- RETOUR ARRIÈRE : fuseaux_pays_retour.sql (copie sur le Bureau) — remet la liste
-- de reaffectation_delai.sql (22 pays, sinon UTC).
-- =============================================================================

begin;

-- §1 Prérequis ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'pays' and column_name = 'fuseau') then
    raise exception 'fuseaux_pays.sql : lancez d''abord reaffectation_delai.sql (pays.fuseau). Rien n''est installé.';
  end if;
end $$;

-- §2 La liste officielle ---------------------------------------------------------------
create or replace function public.fuseaux_du_pays(p_code text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce((select v.fuseaux from (values
    ('AD', array['Europe/Andorra']::text[]),
    ('AE', array['Asia/Dubai']::text[]),
    ('AF', array['Asia/Kabul']::text[]),
    ('AG', array['America/Antigua']::text[]),
    ('AI', array['America/Anguilla']::text[]),
    ('AL', array['Europe/Tirane']::text[]),
    ('AM', array['Asia/Yerevan']::text[]),
    ('AO', array['Africa/Luanda']::text[]),
    ('AQ', array['Antarctica/McMurdo', 'Antarctica/Casey', 'Antarctica/Davis', 'Antarctica/DumontDUrville', 'Antarctica/Mawson', 'Antarctica/Palmer', 'Antarctica/Rothera', 'Antarctica/Syowa', 'Antarctica/Troll', 'Antarctica/Vostok']::text[]),
    ('AR', array['America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba', 'America/Argentina/Salta', 'America/Argentina/Jujuy', 'America/Argentina/Tucuman', 'America/Argentina/Catamarca', 'America/Argentina/La_Rioja', 'America/Argentina/San_Juan', 'America/Argentina/Mendoza', 'America/Argentina/San_Luis', 'America/Argentina/Rio_Gallegos', 'America/Argentina/Ushuaia']::text[]),
    ('AS', array['Pacific/Pago_Pago']::text[]),
    ('AT', array['Europe/Vienna']::text[]),
    ('AU', array['Australia/Lord_Howe', 'Antarctica/Macquarie', 'Australia/Hobart', 'Australia/Melbourne', 'Australia/Sydney', 'Australia/Broken_Hill', 'Australia/Brisbane', 'Australia/Lindeman', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth', 'Australia/Eucla']::text[]),
    ('AW', array['America/Aruba']::text[]),
    ('AX', array['Europe/Mariehamn']::text[]),
    ('AZ', array['Asia/Baku']::text[]),
    ('BA', array['Europe/Sarajevo']::text[]),
    ('BB', array['America/Barbados']::text[]),
    ('BD', array['Asia/Dhaka']::text[]),
    ('BE', array['Europe/Brussels']::text[]),
    ('BF', array['Africa/Ouagadougou']::text[]),
    ('BG', array['Europe/Sofia']::text[]),
    ('BH', array['Asia/Bahrain']::text[]),
    ('BI', array['Africa/Bujumbura']::text[]),
    ('BJ', array['Africa/Porto-Novo']::text[]),
    ('BL', array['America/St_Barthelemy']::text[]),
    ('BM', array['Atlantic/Bermuda']::text[]),
    ('BN', array['Asia/Brunei']::text[]),
    ('BO', array['America/La_Paz']::text[]),
    ('BQ', array['America/Kralendijk']::text[]),
    ('BR', array['America/Noronha', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Araguaina', 'America/Maceio', 'America/Bahia', 'America/Sao_Paulo', 'America/Campo_Grande', 'America/Cuiaba', 'America/Santarem', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Manaus', 'America/Eirunepe', 'America/Rio_Branco']::text[]),
    ('BS', array['America/Nassau']::text[]),
    ('BT', array['Asia/Thimphu']::text[]),
    ('BW', array['Africa/Gaborone']::text[]),
    ('BY', array['Europe/Minsk']::text[]),
    ('BZ', array['America/Belize']::text[]),
    ('CA', array['America/St_Johns', 'America/Halifax', 'America/Glace_Bay', 'America/Moncton', 'America/Goose_Bay', 'America/Blanc-Sablon', 'America/Toronto', 'America/Iqaluit', 'America/Atikokan', 'America/Winnipeg', 'America/Resolute', 'America/Rankin_Inlet', 'America/Regina', 'America/Swift_Current', 'America/Edmonton', 'America/Cambridge_Bay', 'America/Inuvik', 'America/Vancouver', 'America/Creston', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Whitehorse', 'America/Dawson']::text[]),
    ('CC', array['Indian/Cocos']::text[]),
    ('CD', array['Africa/Kinshasa', 'Africa/Lubumbashi']::text[]),
    ('CF', array['Africa/Bangui']::text[]),
    ('CG', array['Africa/Brazzaville']::text[]),
    ('CH', array['Europe/Zurich']::text[]),
    ('CI', array['Africa/Abidjan']::text[]),
    ('CK', array['Pacific/Rarotonga']::text[]),
    ('CL', array['America/Santiago', 'America/Coyhaique', 'America/Punta_Arenas', 'Pacific/Easter']::text[]),
    ('CM', array['Africa/Douala']::text[]),
    ('CN', array['Asia/Shanghai', 'Asia/Urumqi']::text[]),
    ('CO', array['America/Bogota']::text[]),
    ('CR', array['America/Costa_Rica']::text[]),
    ('CU', array['America/Havana']::text[]),
    ('CV', array['Atlantic/Cape_Verde']::text[]),
    ('CW', array['America/Curacao']::text[]),
    ('CX', array['Indian/Christmas']::text[]),
    ('CY', array['Asia/Nicosia', 'Asia/Famagusta']::text[]),
    ('CZ', array['Europe/Prague']::text[]),
    ('DE', array['Europe/Berlin', 'Europe/Busingen']::text[]),
    ('DJ', array['Africa/Djibouti']::text[]),
    ('DK', array['Europe/Copenhagen']::text[]),
    ('DM', array['America/Dominica']::text[]),
    ('DO', array['America/Santo_Domingo']::text[]),
    ('DZ', array['Africa/Algiers']::text[]),
    ('EC', array['America/Guayaquil', 'Pacific/Galapagos']::text[]),
    ('EE', array['Europe/Tallinn']::text[]),
    ('EG', array['Africa/Cairo']::text[]),
    ('EH', array['Africa/El_Aaiun']::text[]),
    ('ER', array['Africa/Asmara']::text[]),
    ('ES', array['Europe/Madrid', 'Africa/Ceuta', 'Atlantic/Canary']::text[]),
    ('ET', array['Africa/Addis_Ababa']::text[]),
    ('FI', array['Europe/Helsinki']::text[]),
    ('FJ', array['Pacific/Fiji']::text[]),
    ('FK', array['Atlantic/Stanley']::text[]),
    ('FM', array['Pacific/Chuuk', 'Pacific/Pohnpei', 'Pacific/Kosrae']::text[]),
    ('FO', array['Atlantic/Faroe']::text[]),
    ('FR', array['Europe/Paris']::text[]),
    ('GA', array['Africa/Libreville']::text[]),
    ('GB', array['Europe/London']::text[]),
    ('GD', array['America/Grenada']::text[]),
    ('GE', array['Asia/Tbilisi']::text[]),
    ('GF', array['America/Cayenne']::text[]),
    ('GG', array['Europe/Guernsey']::text[]),
    ('GH', array['Africa/Accra']::text[]),
    ('GI', array['Europe/Gibraltar']::text[]),
    ('GL', array['America/Nuuk', 'America/Danmarkshavn', 'America/Scoresbysund', 'America/Thule']::text[]),
    ('GM', array['Africa/Banjul']::text[]),
    ('GN', array['Africa/Conakry']::text[]),
    ('GP', array['America/Guadeloupe']::text[]),
    ('GQ', array['Africa/Malabo']::text[]),
    ('GR', array['Europe/Athens']::text[]),
    ('GS', array['Atlantic/South_Georgia']::text[]),
    ('GT', array['America/Guatemala']::text[]),
    ('GU', array['Pacific/Guam']::text[]),
    ('GW', array['Africa/Bissau']::text[]),
    ('GY', array['America/Guyana']::text[]),
    ('HK', array['Asia/Hong_Kong']::text[]),
    ('HN', array['America/Tegucigalpa']::text[]),
    ('HR', array['Europe/Zagreb']::text[]),
    ('HT', array['America/Port-au-Prince']::text[]),
    ('HU', array['Europe/Budapest']::text[]),
    ('ID', array['Asia/Jakarta', 'Asia/Pontianak', 'Asia/Makassar', 'Asia/Jayapura']::text[]),
    ('IE', array['Europe/Dublin']::text[]),
    ('IL', array['Asia/Jerusalem']::text[]),
    ('IM', array['Europe/Isle_of_Man']::text[]),
    ('IN', array['Asia/Kolkata']::text[]),
    ('IO', array['Indian/Chagos']::text[]),
    ('IQ', array['Asia/Baghdad']::text[]),
    ('IR', array['Asia/Tehran']::text[]),
    ('IS', array['Atlantic/Reykjavik']::text[]),
    ('IT', array['Europe/Rome']::text[]),
    ('JE', array['Europe/Jersey']::text[]),
    ('JM', array['America/Jamaica']::text[]),
    ('JO', array['Asia/Amman']::text[]),
    ('JP', array['Asia/Tokyo']::text[]),
    ('KE', array['Africa/Nairobi']::text[]),
    ('KG', array['Asia/Bishkek']::text[]),
    ('KH', array['Asia/Phnom_Penh']::text[]),
    ('KI', array['Pacific/Tarawa', 'Pacific/Kanton', 'Pacific/Kiritimati']::text[]),
    ('KM', array['Indian/Comoro']::text[]),
    ('KN', array['America/St_Kitts']::text[]),
    ('KP', array['Asia/Pyongyang']::text[]),
    ('KR', array['Asia/Seoul']::text[]),
    ('KW', array['Asia/Kuwait']::text[]),
    ('KY', array['America/Cayman']::text[]),
    ('KZ', array['Asia/Almaty', 'Asia/Qyzylorda', 'Asia/Qostanay', 'Asia/Aqtobe', 'Asia/Aqtau', 'Asia/Atyrau', 'Asia/Oral']::text[]),
    ('LA', array['Asia/Vientiane']::text[]),
    ('LB', array['Asia/Beirut']::text[]),
    ('LC', array['America/St_Lucia']::text[]),
    ('LI', array['Europe/Vaduz']::text[]),
    ('LK', array['Asia/Colombo']::text[]),
    ('LR', array['Africa/Monrovia']::text[]),
    ('LS', array['Africa/Maseru']::text[]),
    ('LT', array['Europe/Vilnius']::text[]),
    ('LU', array['Europe/Luxembourg']::text[]),
    ('LV', array['Europe/Riga']::text[]),
    ('LY', array['Africa/Tripoli']::text[]),
    ('MA', array['Africa/Casablanca']::text[]),
    ('MC', array['Europe/Monaco']::text[]),
    ('MD', array['Europe/Chisinau']::text[]),
    ('ME', array['Europe/Podgorica']::text[]),
    ('MF', array['America/Marigot']::text[]),
    ('MG', array['Indian/Antananarivo']::text[]),
    ('MH', array['Pacific/Majuro', 'Pacific/Kwajalein']::text[]),
    ('MK', array['Europe/Skopje']::text[]),
    ('ML', array['Africa/Bamako']::text[]),
    ('MM', array['Asia/Yangon']::text[]),
    ('MN', array['Asia/Ulaanbaatar', 'Asia/Hovd']::text[]),
    ('MO', array['Asia/Macau']::text[]),
    ('MP', array['Pacific/Saipan']::text[]),
    ('MQ', array['America/Martinique']::text[]),
    ('MR', array['Africa/Nouakchott']::text[]),
    ('MS', array['America/Montserrat']::text[]),
    ('MT', array['Europe/Malta']::text[]),
    ('MU', array['Indian/Mauritius']::text[]),
    ('MV', array['Indian/Maldives']::text[]),
    ('MW', array['Africa/Blantyre']::text[]),
    ('MX', array['America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey', 'America/Matamoros', 'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga', 'America/Mazatlan', 'America/Bahia_Banderas', 'America/Hermosillo', 'America/Tijuana']::text[]),
    ('MY', array['Asia/Kuala_Lumpur', 'Asia/Kuching']::text[]),
    ('MZ', array['Africa/Maputo']::text[]),
    ('NA', array['Africa/Windhoek']::text[]),
    ('NC', array['Pacific/Noumea']::text[]),
    ('NE', array['Africa/Niamey']::text[]),
    ('NF', array['Pacific/Norfolk']::text[]),
    ('NG', array['Africa/Lagos']::text[]),
    ('NI', array['America/Managua']::text[]),
    ('NL', array['Europe/Amsterdam']::text[]),
    ('NO', array['Europe/Oslo']::text[]),
    ('NP', array['Asia/Kathmandu']::text[]),
    ('NR', array['Pacific/Nauru']::text[]),
    ('NU', array['Pacific/Niue']::text[]),
    ('NZ', array['Pacific/Auckland', 'Pacific/Chatham']::text[]),
    ('OM', array['Asia/Muscat']::text[]),
    ('PA', array['America/Panama']::text[]),
    ('PE', array['America/Lima']::text[]),
    ('PF', array['Pacific/Tahiti', 'Pacific/Marquesas', 'Pacific/Gambier']::text[]),
    ('PG', array['Pacific/Port_Moresby', 'Pacific/Bougainville']::text[]),
    ('PH', array['Asia/Manila']::text[]),
    ('PK', array['Asia/Karachi']::text[]),
    ('PL', array['Europe/Warsaw']::text[]),
    ('PM', array['America/Miquelon']::text[]),
    ('PN', array['Pacific/Pitcairn']::text[]),
    ('PR', array['America/Puerto_Rico']::text[]),
    ('PS', array['Asia/Gaza', 'Asia/Hebron']::text[]),
    ('PT', array['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores']::text[]),
    ('PW', array['Pacific/Palau']::text[]),
    ('PY', array['America/Asuncion']::text[]),
    ('QA', array['Asia/Qatar']::text[]),
    ('RE', array['Indian/Reunion']::text[]),
    ('RO', array['Europe/Bucharest']::text[]),
    ('RS', array['Europe/Belgrade']::text[]),
    ('RU', array['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Kirov', 'Europe/Volgograd', 'Europe/Astrakhan', 'Europe/Saratov', 'Europe/Ulyanovsk', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Barnaul', 'Asia/Tomsk', 'Asia/Novokuznetsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Chita', 'Asia/Yakutsk', 'Asia/Khandyga', 'Asia/Vladivostok', 'Asia/Ust-Nera', 'Asia/Magadan', 'Asia/Sakhalin', 'Asia/Srednekolymsk', 'Asia/Kamchatka', 'Asia/Anadyr']::text[]),
    ('RW', array['Africa/Kigali']::text[]),
    ('SA', array['Asia/Riyadh']::text[]),
    ('SB', array['Pacific/Guadalcanal']::text[]),
    ('SC', array['Indian/Mahe']::text[]),
    ('SD', array['Africa/Khartoum']::text[]),
    ('SE', array['Europe/Stockholm']::text[]),
    ('SG', array['Asia/Singapore']::text[]),
    ('SH', array['Atlantic/St_Helena']::text[]),
    ('SI', array['Europe/Ljubljana']::text[]),
    ('SJ', array['Arctic/Longyearbyen']::text[]),
    ('SK', array['Europe/Bratislava']::text[]),
    ('SL', array['Africa/Freetown']::text[]),
    ('SM', array['Europe/San_Marino']::text[]),
    ('SN', array['Africa/Dakar']::text[]),
    ('SO', array['Africa/Mogadishu']::text[]),
    ('SR', array['America/Paramaribo']::text[]),
    ('SS', array['Africa/Juba']::text[]),
    ('ST', array['Africa/Sao_Tome']::text[]),
    ('SV', array['America/El_Salvador']::text[]),
    ('SX', array['America/Lower_Princes']::text[]),
    ('SY', array['Asia/Damascus']::text[]),
    ('SZ', array['Africa/Mbabane']::text[]),
    ('TC', array['America/Grand_Turk']::text[]),
    ('TD', array['Africa/Ndjamena']::text[]),
    ('TF', array['Indian/Kerguelen']::text[]),
    ('TG', array['Africa/Lome']::text[]),
    ('TH', array['Asia/Bangkok']::text[]),
    ('TJ', array['Asia/Dushanbe']::text[]),
    ('TK', array['Pacific/Fakaofo']::text[]),
    ('TL', array['Asia/Dili']::text[]),
    ('TM', array['Asia/Ashgabat']::text[]),
    ('TN', array['Africa/Tunis']::text[]),
    ('TO', array['Pacific/Tongatapu']::text[]),
    ('TR', array['Europe/Istanbul']::text[]),
    ('TT', array['America/Port_of_Spain']::text[]),
    ('TV', array['Pacific/Funafuti']::text[]),
    ('TW', array['Asia/Taipei']::text[]),
    ('TZ', array['Africa/Dar_es_Salaam']::text[]),
    ('UA', array['Europe/Simferopol', 'Europe/Kyiv']::text[]),
    ('UG', array['Africa/Kampala']::text[]),
    ('UM', array['Pacific/Midway', 'Pacific/Wake']::text[]),
    ('US', array['America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Chicago', 'America/Indiana/Tell_City', 'America/Indiana/Knox', 'America/Menominee', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome', 'America/Adak', 'Pacific/Honolulu']::text[]),
    ('UY', array['America/Montevideo']::text[]),
    ('UZ', array['Asia/Samarkand', 'Asia/Tashkent']::text[]),
    ('VA', array['Europe/Vatican']::text[]),
    ('VC', array['America/St_Vincent']::text[]),
    ('VE', array['America/Caracas']::text[]),
    ('VG', array['America/Tortola']::text[]),
    ('VI', array['America/St_Thomas']::text[]),
    ('VN', array['Asia/Ho_Chi_Minh']::text[]),
    ('VU', array['Pacific/Efate']::text[]),
    ('WF', array['Pacific/Wallis']::text[]),
    ('WS', array['Pacific/Apia']::text[]),
    ('YE', array['Asia/Aden']::text[]),
    ('YT', array['Indian/Mayotte']::text[]),
    ('ZA', array['Africa/Johannesburg']::text[]),
    ('ZM', array['Africa/Lusaka']::text[]),
    ('ZW', array['Africa/Harare']::text[])
  ) v(code, fuseaux) where v.code = upper(btrim(coalesce(p_code, '')))), '{}'::text[])
$$;
revoke all on function public.fuseaux_du_pays(text) from public, anon;
grant execute on function public.fuseaux_du_pays(text) to authenticated, service_role;
comment on function public.fuseaux_du_pays(text) is 'fichier: fuseaux_pays.sql — généré depuis IANA tz zone.tab 2026c (= lib/fuseauxPays.mjs)';

create or replace function public.fuseau_du_pays(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when cardinality(f) = 1 then f[1] end from (select public.fuseaux_du_pays(p_code) as f) x
$$;
revoke all on function public.fuseau_du_pays(text) from public, anon;
grant execute on function public.fuseau_du_pays(text) to authenticated, service_role;
comment on function public.fuseau_du_pays(text) is 'fichier: fuseaux_pays.sql';

-- §3 Le garde-fou des pays ---------------------------------------------------------------
create or replace function public.pays_fuseau()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_liste text[] := public.fuseaux_du_pays(new.code);
begin
  -- le code change et le fuseau suit l'ancien pays : on le recalcule
  if tg_op = 'UPDATE' and new.code is distinct from old.code and new.fuseau is not distinct from old.fuseau then
    new.fuseau := null;
  end if;
  if new.fuseau is null or btrim(new.fuseau) = '' then
    if cardinality(v_liste) = 1 then
      new.fuseau := v_liste[1];
    elsif cardinality(v_liste) > 1 then
      raise exception 'Le pays % a plusieurs fuseaux horaires (%) : choisissez le sien.', new.nom, array_to_string(v_liste, ', ')
        using errcode = 'check_violation';
    else
      raise exception 'Code pays « % » inconnu : utilisez le code ISO à 2 lettres (Angola = AO, Mali = ML…).', coalesce(new.code, '')
        using errcode = 'check_violation';
    end if;
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.fuseau) then
    raise exception 'Fuseau horaire « % » inconnu.', new.fuseau using errcode = 'check_violation';
  end if;
  if cardinality(v_liste) > 0 and not (new.fuseau = any (v_liste)) then
    raise exception 'Le fuseau % n''est pas celui de % (%) : %.', new.fuseau, new.nom, new.code, array_to_string(v_liste, ', ')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.pays_fuseau() from public, anon, authenticated;
comment on function public.pays_fuseau() is 'fichier: fuseaux_pays.sql';
drop trigger if exists trg_pays_fuseau on public.pays;
create trigger trg_pays_fuseau before insert or update of code, fuseau on public.pays
  for each row execute function public.pays_fuseau();

-- §4 Contrôles ----------------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from (values
    ('AO', 'Africa/Luanda'), ('CG', 'Africa/Brazzaville'), ('GA', 'Africa/Libreville'),
    ('ML', 'Africa/Bamako'), ('SN', 'Africa/Dakar'), ('GN', 'Africa/Conakry')) v(c, z)
   where public.fuseau_du_pays(v.c) is distinct from v.z;
  if n > 0 then
    raise exception 'fuseaux_pays.sql : % des 6 pays d''opération n''a pas le bon fuseau. Rien n''est installé.', n;
  end if;
  select count(*) into n from (select unnest(fuseaux) z from (select public.fuseaux_du_pays(c) fuseaux
    from unnest(array['AO','CD','BR','US','ML']) c) x) y where not exists (select 1 from pg_timezone_names where name = y.z);
  if n > 0 then
    raise exception 'fuseaux_pays.sql : % fuseau(x) de la liste inconnu(s) de ce serveur. Rien n''est installé.', n;
  end if;
  if exists (select 1 from public.pays where fuseau is null) then
    raise exception 'fuseaux_pays.sql : un pays existant n''a pas de fuseau. Rien n''est installé.';
  end if;
end $$;

-- §5 Répétition (annulée) dans l'entreprise de test ---------------------------------------
do $$
declare
  c_test constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_msg text; v_etape text := 'préparation'; v_refus boolean; v_f text;
begin
  if not exists (select 1 from public.tenants where id = c_test) then
    raise notice 'fuseaux_pays.sql : pas d''entreprise de test — répétition sautée.'; return;
  end if;
  begin
    v_etape := 'Mali sans fuseau → Africa/Bamako';
    insert into public.pays (tenant_id, nom, code, devise) values (c_test, 'Répétition Mali', 'ML', 'XOF') returning fuseau into v_f;
    if v_f is distinct from 'Africa/Bamako' then raise exception 'Mali : % au lieu de Africa/Bamako', v_f; end if;

    v_etape := 'RD Congo sans fuseau → refusé (deux fuseaux)';
    v_refus := false;
    begin insert into public.pays (tenant_id, nom, code, devise) values (c_test, 'Répétition RDC', 'CD', 'CDF');
    exception when check_violation then v_refus := sqlerrm like '%plusieurs fuseaux%'; end;
    if not v_refus then raise exception 'RD Congo accepté sans choix de fuseau'; end if;

    v_etape := 'RD Congo avec Lubumbashi → accepté';
    insert into public.pays (tenant_id, nom, code, devise, fuseau) values (c_test, 'Répétition RDC', 'CD', 'CDF', 'Africa/Lubumbashi');

    v_etape := 'Angola avec le fuseau du Mali → refusé';
    v_refus := false;
    begin insert into public.pays (tenant_id, nom, code, devise, fuseau) values (c_test, 'Répétition AO', 'AO', 'AOA', 'Africa/Bamako');
    exception when check_violation then v_refus := true; end;
    if not v_refus then raise exception 'un fuseau d''un autre pays est accepté'; end if;

    v_etape := 'code inconnu → refusé';
    v_refus := false;
    begin insert into public.pays (tenant_id, nom, code, devise) values (c_test, 'Répétition ZZ', 'ZZ', 'XXX');
    exception when check_violation then v_refus := sqlerrm like '%inconnu%'; end;
    if not v_refus then raise exception 'un code inconnu est accepté'; end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'fuseaux_pays.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'fuseaux_pays.sql : fuseaux de 247 pays (base officielle) ; pays à plusieurs fuseaux : on choisit ; code inconnu refusé. Répétition annulée.';
end $$;

commit;

-- Ce qui est en place
select (select string_agg(p.nom || ' → ' || p.fuseau, ', ' order by p.nom) from public.pays p) as pays_existants,
       array_to_string(public.fuseaux_du_pays('CD'), ', ') as exemple_rd_congo;
