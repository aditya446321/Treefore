# TreeForge

Folder tree paste karo (ya folder upload karo) → ZIP download karo ya ek hi commit mein GitHub par push karo.

- Koi build step nahi: `index.html` kholo ya GitHub Pages par host karo (Settings → Pages → main / root).
- Token sirf browser ke localStorage mein; calls seedha `api.github.com` par.
- Khaali GitHub repo bhi supported hai.

## Files
- `index.html` — page
- `css/style.css` — styling
- `js/parser.js` — tree text parser
- `js/zip.js` — ZIP writer
- `js/github.js` — GitHub push logic
- `js/app.js` — UI
