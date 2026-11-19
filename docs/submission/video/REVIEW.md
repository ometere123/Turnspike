# Render audit and four-angle review

## Still-frame audit (skill step 4)
`node scripts/stills.mjs <dir> <comp>:<frames>` bundles once and renders chosen frames.
- **Round 1** (`out/audit1`, 16 frames, one per scene): found the hook's stripe overlapping the headline; the agent scene's code line overflowing its panel and the caption covering the CLI verdict; clipped terminal lines in the owner-limits and receipt scenes; the trailer opener's headline overlapping the screenshot; the trailer's raised barrier leaving the frame; labels under 22 px. All fixed.
- **Round 2** (`out/audit2`): the fixes confirmed, plus one remaining overlap of the code panel in the agent scene, fixed before the full render.

## Four-angle review (skill step 5)
Done as four sequential passes over the same frames, one per critic lens below (the skill suggests four parallel reviewers; one reviewer made all four passes).

### Findings from the rendered MP4s (20 demo frames and 6 trailer frames extracted with ffmpeg)
| Lens | Finding | Fix |
|---|---|---|
| Design and layout | Payment scene: the explorer screenshot ran under the caption and hid its own label | Screenshot reduced to 1100 px wide; label clear of the caption |
| Design and layout | End card lines collided with the caption | End card lines moved up |
| Text and readability | Repository URL and "Unaudited" ran together on one line | Split into two lines, URL in mono |
| Text and readability | Terminal text in the owner-limits panel is 19 px (small at 720p) | Kept: the caption states the same numbers in 36 px |
| Narrative and pacing | Every beat ties to one proof; the payment scene (18 s) gets the most time, as the skill advises for the differentiating moment; the close states limitations before the call to action | none |
| Brand consistency | Archivo expanded headlines, Plex Mono only for machine text, barrier yellow only as a fill, stripes only on the gate and refusals, real site icon, no gradients | none |
| Truthfulness (added lens) | Every hash, number and date matches `evidence/` or the captures; the honesty tag is on every demo frame; the historical payment is labelled "Not a new transaction" | none |

## Final renders
- `out/TurnspikeHackathonDemo.mp4`: 120.04 s, 1920x1080, 30 fps, h264 crf 18.
- `out/TurnspikeLaunchTrailer.mp4`: 28.05 s, 1920x1080, 30 fps, h264 crf 18.
