/*
 * Çok oyunculu bağlantı (bkz. COK-OYUNCULU.md, server/relay.mjs).
 * Tembel: ilk send() çağrısında bağlanır, bağlanana kadar iletileri sıraya
 * koyar — oyuncu "Oda kur"a basmadan sunucuya hiç bağlanılmaz.
 * Yeniden bağlanma yok: bağlantı koparsa { t:'closed' }, kurulamazsa
 * { t:'error' } üretir; oyuncu odaya yeniden katılır.
 */
type Msg = { t: string; [k: string]: any };

const URL_ = import.meta.env.VITE_MP_URL || (location.host
  ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mp`
  : 'ws://localhost:8787');            // file:// ile açıldıysa

let ws: WebSocket | null = null;
let queue: string[] = [];
let listener: (m: Msg) => void = () => {};

function connect(){
  let me: WebSocket, opened = false;
  try{ me = new WebSocket(URL_); }
  catch(e){ listener({ t:'error', msg:'Sunucuya bağlanılamadı.' }); return; }
  ws = me;
  me.onopen = () => { opened = true; for(const s of queue) me.send(s); queue = []; };
  me.onmessage = e => {
    if(ws !== me) return;
    let m: Msg; try{ m = JSON.parse(e.data); }catch(err){ return; }
    if(m && typeof m.t === 'string') listener(m);
  };
  // ws !== me: bilerek kapatılan eski bağlantı "koptu" iletisi üretmesin
  me.onclose = () => {
    if(ws !== me) return;
    ws = null; queue = [];
    listener(opened ? { t:'closed' } : { t:'error', msg:'Sunucuya bağlanılamadı. İnternet bağlantını kontrol edip yeniden dene.' });
  };
}

export const net = {
  get open(){ return !!ws && ws.readyState === 1; },
  on(fn: (m: Msg) => void){ listener = fn; },
  send(m: Msg){
    const s = JSON.stringify(m);
    if(ws && ws.readyState === 1){ ws.send(s); return; }
    queue.push(s);
    if(!ws) connect();
  },
  close(){ const w = ws; ws = null; queue = []; if(w) try{ w.close(); }catch(e){} },
};
