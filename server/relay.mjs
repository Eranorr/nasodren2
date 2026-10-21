/*
 * ÇOK OYUNCULU AKTARIM SUNUCUSU (bkz. COK-OYUNCULU.md)
 *
 * Oyun sunucusu değil: oyun kuralı çalıştırmıyor. Odayı, ev sahibini, turun
 * başlayıp bittiğini biliyor; oyuncuların gönderdiği anlık durumu odadaki
 * diğerlerine iletiyor. Her cihaz kendi oyununu oynatıyor, aynı günü aynı
 * tohumla aynı anda başlatıyor. Hiçbir şey saklanmıyor: oda bellekte, son
 * oyuncu çıkınca siliniyor.
 *
 * Çalıştırma:
 *   npm run dev / npm run preview  → Vite eklentisi (relayPlugin) 8787'de açar,
 *                                    Vite /mp yolunu oraya yönlendirir
 *   npm run mp                     → tek başına, PORT (varsayılan 8787); yayında bu
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

/* ---- Sinüs Harekâtı'na göre değişen yerler ---- */
const MAX_PLAYERS = 3;
const COLORS = [0, 1, 2];        // oyuncu rengi: odadaki boş ilk renk
const LAST_LEVEL = 11;           // 12 günlük kür (0..11)
const START_IN = 8000;           // giriş sahnesi (~5 sn) + geri sayım
const NAME_MAX = 12;             // oyundaki ad kutusuyla aynı

/* ---- oyundan bağımsız ---- */
const MAX_PAYLOAD = 4096;        // daha büyük ileti bağlantıyı düşürür
const RATE = 40;                 // saniyede en çok ileti
const HEARTBEAT = 20000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // I/1, O/0 yok

const rooms = new Map();
let idSeq = 0;

function newCode(){
  for(;;){
    let c = '';
    for(let i=0;i<4;i++) c += CODE_CHARS[(Math.random()*CODE_CHARS.length)|0];
    if(!rooms.has(c)) return c;
  }
}
function cleanName(s){
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}
const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
function send(ws, m){ if(ws.readyState === 1) ws.send(JSON.stringify(m)); }
function cast(room, m, except){ const s = JSON.stringify(m); for(const p of room.players) if(p !== except && p.readyState === 1) p.send(s); }
const list = room => room.players.map(p => ({ id:p.id, name:p.name, color:p.color, away:!!p.away }));

/* Tur bitti: herkes fin göndermiş ya da arka planda. Bu olmadan telefonu
   kilitleyen bir oyuncu turu sonsuza kadar asılı bırakır. */
function roundDone(room){ return room.players.every(p => room.fins.has(p.id) || p.away); }
function checkRound(room){ if(room.phase === 'round' && roundDone(room)) room.phase = 'lobby'; }

function enter(ws, room, name){
  ws.id = ++idSeq;
  ws.name = cleanName(name) || 'Oyuncu';
  ws.color = COLORS.find(c => !room.players.some(p => p.color === c));
  ws.away = false;
  ws.room = room;
  room.players.push(ws);
  if(!room.host) room.host = ws.id;
  send(ws, { t:'room', code:room.code, you:ws.id, host:room.host, players:list(room), round:room.round });
  cast(room, { t:'players', host:room.host, players:list(room) }, ws);
}
function leave(ws){
  const room = ws.room;
  if(!room) return;
  ws.room = null;
  room.players = room.players.filter(p => p !== ws);
  if(!room.players.length){ rooms.delete(room.code); return; }
  if(room.host === ws.id) room.host = room.players[0].id;   // ev sahibi çıkınca ilk oyuncu
  checkRound(room);
  cast(room, { t:'players', host:room.host, players:list(room), left:ws.id });
}

function handle(ws, m){
  const room = ws.room;
  switch(m.t){
    case 'create': {
      leave(ws);
      const r = { code:newCode(), host:0, players:[], phase:'lobby', round:0, fins:new Set() };
      rooms.set(r.code, r);
      enter(ws, r, m.name);
      break;
    }
    case 'join': {
      const r = rooms.get(String(m.code || '').toUpperCase().slice(0, 4));
      if(!r) return send(ws, { t:'error', msg:'Bu kodla bir oda yok. Kodu kontrol et.' });
      if(r === room) return;
      if(r.players.length >= MAX_PLAYERS) return send(ws, { t:'error', msg:'Oda dolu: en fazla ' + MAX_PLAYERS + ' kişi.' });
      if(r.phase === 'round') return send(ws, { t:'error', msg:'Bu odada tur sürüyor. Tur bitince yeniden dene.' });
      leave(ws);
      enter(ws, r, m.name);
      break;
    }
    case 'leave': leave(ws); break;
    case 'start': {
      if(!room || room.host !== ws.id) return;
      checkRound(room);
      if(room.phase === 'round') return send(ws, { t:'error', msg:'Tur henüz bitmedi.' });
      if(room.players.length < 2) return send(ws, { t:'error', msg:'Başlatmak için en az 2 oyuncu gerekli.' });
      room.round++;
      room.phase = 'round';
      room.fins = new Set();
      /* tot: ev sahibinin tuttuğu toplam puanlar — sonradan katılan oyuncu da
         sıralamayı herkesle aynı görsün. fresh: yeni kür, toplamlar sıfır. */
      const tot = Array.isArray(m.tot) ? m.tot.slice(0, MAX_PLAYERS).map(e => [num(e && e[0])|0, num(e && e[1])|0]) : [];
      cast(room, { t:'start', round:room.round, level:Math.max(0, Math.min(LAST_LEVEL, m.level|0)),
        seed:(Math.random()*4294967296)>>>0, in:START_IN, fresh:!!m.fresh, tot });
      break;
    }
    case 'st':   // içeriğe bakılmıyor; oyunun durum biçimi değişince sunucu değişmez
      if(room && room.phase === 'round') cast(room, { ...m, from:ws.id }, ws);
      break;
    case 'fin': {
      if(!room || room.phase !== 'round' || room.fins.has(ws.id)) return;
      room.fins.add(ws.id);
      cast(room, { t:'fin', from:ws.id, ok:!!m.ok, time:num(m.time), pct:num(m.pct)|0, score:num(m.score)|0,
        why:m.why === 'time' ? 'time' : m.why === 'out' ? 'out' : '' });
      checkRound(room);
      break;
    }
    case 'away':
      ws.away = !!m.on;
      if(room){ cast(room, { t:'away', from:ws.id, on:ws.away }, ws); checkRound(room); }
      break;
  }
}

function attach(wss){
  wss.on('connection', ws => {
    ws.alive = true; ws.room = null;
    ws.rateT = 0; ws.rateN = 0;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', raw => {
      const now = Date.now();
      if(now - ws.rateT > 1000){ ws.rateT = now; ws.rateN = 0; }
      if(++ws.rateN > RATE) return;
      let m; try{ m = JSON.parse(raw); }catch(e){ return; }
      if(m && typeof m.t === 'string') handle(ws, m);
    });
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
  });
  /* Nabız: telefon Wi-Fi'den düşünce ya da tarayıcı öldürülünce close hiç
     gelmeyebilir; pong vermeyen bağlantı kapatılıyor (hayalet oyuncu kalmasın). */
  const beat = setInterval(() => {
    for(const ws of wss.clients){
      if(!ws.alive){ ws.terminate(); continue; }
      ws.alive = false;
      try{ ws.ping(); }catch(e){}
    }
  }, HEARTBEAT);
  wss.on('close', () => clearInterval(beat));
}

/* Sunucuyu açar. Port doluysa (aynı makinede ikinci Vite) açmaz: hepsi aynı
   aktarım sunucusunu, yani aynı odaları görür. */
export function startRelay(port = 8787, quiet = false){
  const state = { ok:false };
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type':'text/plain' }); res.end('Sinüs Harekâtı aktarım sunucusu'); });
  const wss = new WebSocketServer({ server, maxPayload:MAX_PAYLOAD });
  attach(wss);
  // ws, sunucunun hatasını kendisi de yayıyor; dinleyen yoksa süreç çöküyor (port doluyken)
  wss.on('error', () => {});
  server.on('error', e => {
    if(e.code === 'EADDRINUSE'){ if(!quiet) console.log('[mp] ' + port + ' dolu; çalışan aktarım sunucusu kullanılacak.'); }
    else console.error('[mp]', e.message);
    wss.close();
  });
  server.listen(port, () => { state.ok = true; if(!quiet) console.log('[mp] aktarım sunucusu :' + port); });
  return state;
}

/* Vite eklentisi: geliştirme ve önizleme sunucusunda aktarım sunucusunu açar,
   /mp yolunu ona yönlendirir. Telefon sayfayı 192.168.x.x:5173'ten açınca
   WebSocket aynı adres ve porttan gidiyor: ek güvenlik duvarı izni, CORS ya da
   karışık içerik sorunu yok. */
export function relayPlugin(port = 8787){
  const ensure = () => { if(!globalThis.__mpRelay || !globalThis.__mpRelay.ok) globalThis.__mpRelay = startRelay(port); };
  const proxy = { '/mp': { target:'ws://127.0.0.1:' + port, ws:true,
    // sunucuyu tutan süreç kapandıysa yeniden aç; oyuncu yeniden denediğinde bağlanır
    configure: p => p.on('error', () => { globalThis.__mpRelay = null; ensure(); }) } };
  return {
    name:'mp-relay',
    config: () => ({ server:{ proxy }, preview:{ proxy } }),
    configureServer(){ ensure(); },
    configurePreviewServer(){ ensure(); },
  };
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startRelay(+process.env.PORT || 8787);
