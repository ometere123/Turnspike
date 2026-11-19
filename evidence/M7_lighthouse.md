# Lighthouse (v12, mobile profile with default throttling, headless Chrome)

| Target | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| Local `next start`, before fixes: home | 68 | 100 | 96 | 100 | 1.4 s | 4.1 s | 720 ms | 0 |
| Local, after fixes: home | 70 | 100 | 100 | 100 | 1.6 s | 3.6 s | 870 ms | 0 |
| Vercel production: home | 92 | 100 | 100 | 100 | 1.2 s | 2.7 s | 210 ms | 0 |
| Vercel production: playground | 90 | 100 | 100 | 100 | 1.5 s | 1.8 s | 370 ms | 0.023 |

What changed: hero content no longer waits for JavaScript to become visible (it was the LCP element behind a client-side animation), ethers is no longer loaded on marketing pages (the wallet provider moved to /app and /playground), the interactive hero visual is the only client component on the home page, the animation library uses the small feature set, a favicon was added (a 404 was logged as a console error), and contrast colours were corrected.
Local numbers are lower than production because the local server has no CDN or Brotli. Single runs, not averages; scores vary run to run. The CLS on the playground comes from cards filling in after data loads; placeholder heights were enlarged after this run and not re-measured.
