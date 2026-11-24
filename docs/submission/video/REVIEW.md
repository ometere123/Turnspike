> **History.** This describes the videos of 19 November 2026, which are not submitted. The submitted video is in [README.md](README.md).

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

## Revision 2 (real captures)
- Still audit (`out/audit5`, `out/audit6`): the curl panel's text was too small and its JSON line was cut off (now wrapped, 16 px); the probe panel ran into the caption (moved up, 17 px); combined source tags were too long (shortened).
- Full-render review (`out/review2/grid.png`, 18 frames): every scene shows the correct source tag; the historical payment is labelled "Not a new transaction; nothing was paid while recording"; refusals are labelled as made on 19 Nov and opened today.
- Truthfulness: a line was added to the close, "The deployed contract is a coverage-instrumented build of the tested source", after the explorer capture showed instrumented verified source and the on-chain bytecode (9,610 bytes) was found to differ from a clean compile (3,570 bytes).
- Audio: both MP4s carry a silent stereo AAC track (mean volume -91 dB); all narration is burned-in captions.
- Final: `out/TurnspikeHackathonDemo.mp4`, 120.04 s, 1920x1080, 30 fps, h264, SHA-256 prefix `d4d12083d0c09acc`. The trailer is unchanged (`7c0908b2ec25e918`): the 893x624 captures would not improve its full-frame shots.
