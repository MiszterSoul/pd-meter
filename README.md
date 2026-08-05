# PD Meter

Mobilbarát, kliensoldali pupillatávolság-becslő webalkalmazás.

## Funkciók

- kamera vagy feltöltött kép használata;
- MediaPipe Face Landmarker alapú írisz- és arcpontfelismerés;
- bankkártyás (85,60 mm) vagy egyedi hosszúságú kalibráció;
- kézzel korrigálható pupilla- és referenciapontok;
- teljes, jobb és bal oldali PD becslése;
- a kép helyben marad, nincs szerveroldali feltöltés;
- telepíthető PWA és GitHub Pages deployment.

## GitHub Pages

A repository **Settings → Pages → Build and deployment → Source** beállításánál válaszd a **GitHub Actions** lehetőséget. Ezután a `main` ágra történő push automatikusan publikálja az oldalt.

Várható cím:

`https://misztersoul.github.io/pd-meter/`

## Fontos

A mérés tájékoztató jellegű, nem minősül optikai vagy orvostechnikai centrálásnak. A bankkártyát a szemekkel azonos síkban kell tartani. Progresszív, prizmatikus vagy erős korrekcióhoz optikai mérés ajánlott.
