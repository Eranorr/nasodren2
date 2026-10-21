import { defineConfig } from 'vite';
import { relayPlugin } from './server/relay.mjs';

// GOAL-004: relative base so the production build works both at a domain
// root and under a sub-path (e.g. GitHub Pages project sites:
// https://<user>.github.io/<repo>/), without any code changes.
//
// GOAL-020: `npm run dev` artik LAN'a da aciliyor (host: true). Vite baslarken
// "Network: http://192.168.x.x:5173/" satirini yazar; ayni Wi-Fi'daki telefondan
// o adres acilinca oyun dokunmatik kontrollerle test edilebilir. Windows ilk
// seferde guvenlik duvari izni sorabilir — "Ozel aglar"a izin vermek yeterli.
//
// Cok oyunculu: relayPlugin aktarim sunucusunu (server/relay.mjs) 8787'de acip
// /mp yolunu oraya yonlendiriyor; ayri terminal gerekmiyor. Telefon ayni
// adresten (http://192.168.x.x:5173) cok oyunculuya da baglaniyor.
export default defineConfig({
  base: './',
  plugins: [relayPlugin()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
