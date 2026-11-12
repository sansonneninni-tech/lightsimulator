# Light Simulator

Strumento per direttori della fotografia: carichi la foto di un luogo, ottieni la stanza in 3D con le luci lette dalla foto, le modifichi o ne aggiungi altre e scatti un render fotorealistico.

## Come si usa

1. Trascina una foto del luogo nella pagina (o "prova con una stanza di esempio").
2. L'app stima la profondità, ricostruisce la stanza e accende una alla volta le sorgenti di luce trovate (lampade, plafoniere, neon, finestre).
3. Muoviti nella stanza: trascina per guardarti intorno, rotella o W A S D per camminare, Q/E per scendere e salire, tasto destro per spostarti di lato. `F` torna all'inquadratura della foto.
4. Luci: trascina il punto per spostarla (Alt per l'altezza), il mirino per puntarla, l'anello in verticale per l'intensità in stop, la rotella per i Kelvin. Un tocco apre la scheda (intensità con lux e diaframma sul soggetto, Kelvin e gel, tipo di apparecchio; "Più" per morbidezza, fascio, diffusione, alette, fotometria). Doppio clic sulla scena aggiunge una luce già puntata ed esposta.
5. Persone: 6 pose (in piedi, seduto, steso, in ginocchio, cammina, braccia conserte); doppio clic sull'anello per il manichino con le articolazioni.
6. Camera: focale, sensore, ISO, diaframma, otturatore, false color, esposimetro a luce incidente, mascherine di formato.
7. In alto a destra: ora del giorno, stagione, meteo e orientamento per la luce dalle finestre.
8. Il pulsante bianco scatta il render finale in path tracing (con profondità di campo). Dal rullino: immagine, pianta luci, lista materiale (CSV) e PDF per la troupe.
9. Spazio mostra la foto originale; Cmd+Z annulla; Cmd+S salva il progetto `.luce` da condividere.

## Sviluppo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # cartella dist/ statica, pubblicabile ovunque
```

Tutto gira nel browser: nessun server, nessun costo di calcolo.

- Profondità: Depth Anything V2 Small (ONNX Runtime Web, WebGPU o WASM), scaricato da Hugging Face alla prima foto e poi tenuto in cache. Se esiste `public/models/depth.onnx` viene usato quello: la versione pubblicata lo include (Depth Anything V2 Small, licenza Apache 2.0, pesi in mezza precisione, 50 MB) e lo tiene in cache dopo la prima foto. Per rigenerarlo: scarica il modello ONNX fp32 e salva i pesi in fp16 con nodi Cast (script in `tools/weights_fp16.py`). Senza modello l'app ripiega su una stima geometrica della stanza.
- Anteprima: Three.js con luci fotometriche (lumen, candele, lux), ombre, luce indiretta stimata, tone mapping neutro ed esposizione fisica (EV100 da ISO, diaframma, otturatore).
- Render finale: `three-gpu-pathtracer`.

## Struttura

- `src/engine/` fotometria, profondità, ricostruzione, sole, manichino, motore 3D
- `src/ui/` interfaccia (dock, schede, maniglie, visore)
- `src/export/` pianta luci, lista materiale, PDF

## Pubblicazione

La versione online è servita da GitHub Pages dal ramo `gh-pages`, che contiene solo la cartella `dist` già costruita (modello compreso):

```
npm run build
cd dist && touch .nojekyll && git init -b gh-pages && git add -A && git commit -m "Pubblicazione" && git push -f https://github.com/sansonneninni-tech/lightsimulator gh-pages
```
