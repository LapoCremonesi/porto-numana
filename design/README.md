# Canvas di design

Sorgenti del canvas di design del sito (Claude Design).

- `*.dc.html` — un artboard ciascuno: le quattro schermate del sito più la
  tavola del sistema visivo.
- `canvas.json` — posizione degli artboard sulla tela.
- `satellite.jpg`, `modello3d.jpg` — render reali del sito, ridimensionati,
  usati dentro gli artboard al posto di riquadri finti.

I valori (colori, scala tipografica, spaziature) sono presi da
`../public/css/style.css`: se cambia il foglio di stile vanno riallineati qui.

Il file pubblicato viene rigenerato da questi sorgenti e non è versionato:
pesa ~2 MB, perché incorpora l'editor.
