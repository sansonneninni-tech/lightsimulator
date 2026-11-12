# Light Simulator

Strumento per direttori della fotografia: carichi la foto di un luogo, ottieni la stanza in 3D con le luci lette dalla foto, le modifichi o ne aggiungi altre e scatti un render fotorealistico.

## Come si usa

1. Scegli una stanza di partenza (soggiorno, camera da letto, cucina, ufficio, teatro di posa o stanza vuota). La stanza è subito arredata e illuminata dalle finestre e dalle lampade.
2. **Stanza** nel dock: scheda *Arredi* per aggiungere 17 tipi di mobili (divano, poltrona, sedia, tavolo, letto, libreria, cucina, piante, lampade da terra, da tavolo e lampadari che fanno luce vera); scheda *Stanza* per misure, pareti, pavimento e per aggiungere finestre, portafinestre e porte sulla parete che stai guardando.
3. Tocca un mobile o una finestra per sceglierli (riquadro bianco e scheda accanto), poi trascinali per spostarli. R gira il mobile di 90°, Canc lo toglie. Le lampade da tavolo restano sopra il mobile su cui stanno.
4. Muoviti nella stanza: trascina per guardarti intorno, rotella o W A S D per camminare, Q/E per scendere e salire, tasto destro per spostarti di lato. `F` torna alla vista iniziale.
5. Luci: trascina il punto per spostarla (Alt per l'altezza), il mirino per puntarla, l'anello in verticale per l'intensità in stop, la rotella per i Kelvin. Un tocco apre la scheda (intensità con lux e diaframma sul soggetto, Kelvin e gel, tipo di apparecchio; "Più" per morbidezza, fascio, diffusione, alette, fotometria). Doppio clic sulla scena aggiunge una luce già puntata ed esposta.
6. Persone: 6 pose; doppio clic sull'anello per il manichino con le articolazioni.
7. Camera: focale, sensore, ISO, diaframma, otturatore, fuoco, false color, esposimetro, formati, esposizione automatica.
8. In alto a destra: ora del giorno, stagione, meteo e orientamento: il sole e il cielo entrano dalle finestre.
9. Il pulsante bianco scatta il render finale: tutta la stanza in path tracing (luce che rimbalza su pareti e mobili, sole e cielo dalle finestre, lampade dentro i paralumi), ripulito dal rumore. Dal rullino: immagine, pianta luci con gli arredi, lista materiale (CSV) e PDF per la troupe.
10. Cmd+Z annulla; Cmd+S salva il progetto `.luce` da condividere.

Il caricamento da foto (ricostruzione della stanza dalla foto) è messo da parte: il codice resta in `src/project.ts` e `src/engine/reconstruct.ts` ma non è più nel percorso dell'app.

## Sviluppo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # cartella dist/ statica, pubblicabile ovunque
```

Tutto gira nel browser: nessun server, nessun costo di calcolo.

- Profondità: Depth Anything V2 Small (ONNX Runtime Web, WebGPU o WASM), scaricato da Hugging Face alla prima foto e poi tenuto in cache. Se esiste `public/models/depth.onnx` viene usato quello: la versione pubblicata lo include (Depth Anything V2 Small, licenza Apache 2.0, pesi in mezza precisione, 50 MB) e lo tiene in cache dopo la prima foto. Per rigenerarlo: scarica il modello ONNX fp32 e salva i pesi in fp16 con nodi Cast (script in `tools/weights_fp16.py`). Senza modello l'app ripiega su una stima geometrica della stanza.
- Anteprima: Three.js con luci fotometriche (lumen, candele, lux), ombre, luce indiretta stimata, tone mapping neutro ed esposizione fisica (EV100 da ISO, diaframma, otturatore).
- Scatto: la stessa composizione dell'anteprima (foto o stanza ricostruita, con le luci lette regolate) a piena risoluzione, più le luci aggiunte calcolate in path tracing con `three-gpu-pathtracer` (ombre morbide e rimbalzi sui colori della stanza). Così lo scatto ha gli stessi colori e la stessa esposizione dell'anteprima.

## Struttura

- `src/engine/` motore 3D, stanza costruita (`room.ts`), arredi (`furniture.ts`), pulizia del rumore (`denoise.ts`), fotometria, sole, manichino; ricostruzione da foto (messa da parte)
- `src/build.ts` modelli di stanza, modifica di stanza, arredi e aperture
- `src/ui/` interfaccia (dock, schede, maniglie, visore)
- `src/export/` pianta luci, lista materiale, PDF

## Pubblicazione

La versione online è servita da GitHub Pages dal ramo `gh-pages`, che contiene solo la cartella `dist` già costruita (modello compreso):

```
npm run build
cd dist && touch .nojekyll && git init -b gh-pages && git add -A && git commit -m "Pubblicazione" && git push -f https://github.com/sansonneninni-tech/lightsimulator gh-pages
```
