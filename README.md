# TreeForge

Folder tree paste karo, khud likho, ya folder upload karo → ZIP download karo ya ek hi flow mein GitHub par push karo.

- Koi build step nahi: `index.html` kholo ya GitHub Pages par host karo (Settings → Pages → main / root).
- Token sirf browser ke localStorage mein; calls seedha `api.github.com` par. Token tab tak saved rehta hai jab tak GitHub use reject (401) na kare.
- Page load par koi GitHub call nahi hoti. Repo list sirf push dialog kholne par aati hai.
- Khaali repo apne aap detect hota hai aur set up ho jata hai (pehli real file se initial commit, phir baaki files).

## Files
- `index.html` — page
- `css/style.css` — styling
- `js/parser.js` — tree parser + galti checker + Tidy
- `js/zip.js` — ZIP writer
- `js/github.js` — GitHub push logic
- `js/app.js` — UI
