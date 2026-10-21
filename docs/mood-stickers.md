# 오늘의 기분 전용 이모티콘

2026-10-21. Built-in `image_gen` mode, transparent image generation with existing app illustrations as references. No paid CLI/API fallback was used.

## Delivered assets

- `assets/mood-rabbit-v1.webp` — 이토끼 16 poses, 1024 × 1024 RGBA WebP (267,302 bytes).
- `assets/mood-sweet-v1.webp` — 구마구마 16 poses, 1024 × 1024 RGBA WebP (239,168 bytes).

Both generated PNG originals are retained in the source project's `assets/mood-rabbit-original.png` and `assets/mood-sweet-original.png`. Web delivery copies preserve alpha and are resized for the small mood cards. Each pose is rendered through an SVG viewport onto the raster atlas; images are not stored in Firebase mood records.

## Generation prompt set

Shared specification: Create a new transparent square 4 × 4 sticker atlas for the couple app's Today’s Mood picker. Use `chat-sticker-atlas.webp` as the style reference and the corresponding daily character portrait as the character identity reference. Keep the same cute 2D hand-painted pastel character, soft shading, rounded shapes, warm brown facial details, pink cheeks and consistent proportions. Sixteen separate full-body poses in four rows, four columns, no background tiles, grid lines, captions, words or labels. Keep generous transparent margins around every pose. Avoid glossy 3D rendering and unrelated characters.

Rabbit-specific specification: the app's plump white rabbit with rounded long pink-lined ears, brown eyes and facial details, pink cheeks and pink paw pads. Reference `rabbit-daily-icon.png` for identity, not its backdrop.

Guma-specific specification: the app's squat, round purple/magenta sweet potato character with a golden yellow exposed top, tiny arms and legs and a cute brown face. Reference `sweet-daily-icon.png` for identity, not its backdrop. Keep Guma as a sweet potato, not a rabbit or another species.

Row-major poses used in both prompts:

| Index | Expression | Pose |
| --- | --- | --- |
| 0 | 사랑해 | Hugging a big pink heart |
| 1 | 보고 싶어 | Pleading eyes, holding a little heart |
| 2 | 안아줘 | Arms open for a hug |
| 3 | 고마워 | A grateful bow, holding flowers |
| 4 | 행복해 | Serene smile, hands on cheeks |
| 5 | 신나 | Joyful jump, small golden sparkles |
| 6 | 응원해 | Cheering with a small pink flag |
| 7 | 삐졌어 | Puffed cheeks, folded arms |
| 8 | 속상해 | Sad face with a tear |
| 9 | 미안해 | Bowed head, paws together |
| 10 | 졸려 | Sleeping on a pillow |
| 11 | 피곤해 | Tired, slumped posture |
| 12 | 배고파 | Empty bowl and spoon |
| 13 | 집중 중 | Reading a notebook, round glasses |
| 14 | 쉬는 중 | Relaxing with a warm mug |
| 15 | 아파 | Blanket and a cool forehead compress |

## Runtime behavior

The picker uses the logged-in person's character, grouped into 애정 / 기분 / 일상 with an 전체 filter. It stores stable `moodId`, a label, a backward-compatible emoji, timestamp, version and reactions under the existing per-day/per-person Firebase path. Existing emoji-only records retain their label and map to the closest character expression. A new mood resets previous hearts; version checks reject a heart meant for an older mood. Existing authentication and data retention stay in effect.

Validation: `node tests/mood-stickers.cjs` (requires `jsdom`; set `JSDOM_PATH` outside the original workstation). Tests use an in-memory Firebase substitute and do not write production data. Mobile light/dark previews were visually checked in the browser; this is not a physical-device Firebase end-to-end test.
