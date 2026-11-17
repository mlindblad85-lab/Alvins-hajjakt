# Hajjakten – speldesign och teknisk spec (prototyp v1)

Mobilspel i webbläsaren. Målgrupp barn 10–15 år. All text i spelet på **svenska**. Stil: modern, inte barnslig. Mörkblå havsbakgrund, färgglada hinder. Ingen copyright-skyddad grafik, inga emoji i UI (rita ikoner med canvas/SVG).

Leverans: en mapp `src/` som sedan buntas till EN fristående `dist/index.html` (all JS/CSS inline). Inga externa beroenden utom ev. Google Fonts (Space Grotesk rubriker, Inter brödtext) med systemfont som fallback.

## Färgpalett (från godkänd skiss)
- Bakgrund djup `#031A33`, mellan `#06305A`, ljusare vatten `#0A4A80`
- Text `#EAF4FF`, dämpad text `#9DB8D6`
- Primär accent (knappar) `#3CE0B4` med mörk text `#022A22`
- Fara/haj `#FF5A5F`, guld/rekord `#FFC83D`
- Ytor `rgba(255,255,255,0.06–0.1)`, rundade hörn 14–22 px, knappar minst 44 px höga (spelknappar ~96 px)

## Flöde
1. **Start**: logga "HAJJAKTEN", fält "Ditt smeknamn" (3–12 tecken, bokstäver inkl. åäö, siffror, `_`), text "Syns för alla på topplistan. Inga riktiga namn.", knapp "Välj din fisk", topp 3 idag + länk "Hela topplistan". Ljud av/på-knapp. Smeknamnet sparas i localStorage och fylls i nästa gång. Fult-ord-filter (svenska + engelska, normalisera leetspeak som 0→o, 1→i, 3→e, 4→a, 5→s, @→a, och ta bort upprepade tecken) – vid träff: "Välj ett annat smeknamn".
2. **Välj fisk**: stor förhandsvisning av vald fisk, rutnät 3 kolumner med 12 fiskar. 6 är öppna från början, 6 låses upp (se Fiskar). Låsta visas nedtonade med hänglås och villkor. Knapp "Simma!".
3. **Spel** (liggande läge, se nedan).
4. **Level klar** (overlay mellan levlar): "LEVEL N KLARAD", "Du kom undan!", 1–3 stjärnor, rutor: Tid, Pärlor, Krockar, Totalt hittills. Ruta "Nästa: Level N+1 · <Miljö>. Hajen är snabbare och krockar kostar mer." Knapp "Fortsätt till level N+1". Auto-fortsätt inte.
5. **Uppäten-animation** (2–3 s, slow motion) → **Game over/topplista**: "Uppäten!", slutpoäng stort, level nådd, ev. "Nytt personbästa!" (guld, konfetti). Rad som lockar: "Du är #7 idag" och "Bara 280 p till plats 6". Knappar "Spela igen" (primär, startar direkt med samma fisk från level 1), "Byt fisk", "Topplista".
6. **Topplista**: flikar Idag / Veckan / Alla tider. Topp 50, plats, smeknamn, fiskikon (liten), level nådd, poäng. Egen rad markerad. Topp 3 med guld/silver/brons-badge.

Menyerna ska fungera i både stående och liggande. Spelvyn kräver liggande.

## Liggande spelläge
- Vid "Simma!": försök `document.documentElement.requestFullscreen()` och `screen.orientation.lock('landscape')` (fånga fel tyst; iOS stöder inte).
- Om skärmen är stående under spel: pausa och visa overlay med roterande-telefon-ikon och texten "Vrid mobilen för att spela". Fortsätt automatiskt (efter 3-2-1 nedräkning) när den är liggande.
- Nedräkning 3-2-1 innan varje level startar.
- Pausknapp uppe till höger (meny: Fortsätt, Ljud på/av, Avsluta rundan). Pausa automatiskt vid `visibilitychange`.

## Styrning
- Två stora runda knappar (96 px): **UPP** nere till vänster, **NED** nere till höger (tummarna). Halvgenomskinliga.
- Håll in = fisken rör sig kontinuerligt (vertikal hastighet ≈ 0,9 × spelplanens höjd per sekund, med mjuk acceleration ~0,08 s). Multi-touch: båda samtidigt = stilla.
- Desktop: piltangenter och W/S.
- Använd pointer events, `touch-action: none`, förhindra zoom/scroll/kontextmeny/textmarkering.

## Spelvärlden
- Fisken simmar mot höger; den står fast på x ≈ 35 % av bredden, världen scrollar åt vänster.
- HUD överst (gradient-bakgrund): level-pill "LEVEL 2 · KORALLREVET", framstegsbar för levelns tid ("32 / 45 s"), poäng stort, pärl-räknare, aktiva power-ups med nedräkning, pausknapp. Vänster: indikator "Hajen: 2,4 m bakom" med röd prick, och röd vinjett i vänsterkanten som blir starkare ju närmare hajen är.
- Spelplanens höjd = hela höjden under HUD-raden. Botten- och toppkant är väggar (ingen skada, fisken stoppas bara).

## Haj-mekanik (avstånd i meter)
- `gap` = avstånd fisk–haj. Start 6,0 m, max 7,0 m. `gap <= 0` → uppäten.
- Hajen ritas på x = fiskX − gap × pxPerMeter (pxPerMeter ≈ bredd/22), så den syns i vänsterkanten och kryper närmare. Hajens y följer fiskens y med fördröjning (lerp ~2,5/s) och väjer automatiskt för hinder (visuellt: styr runt hindret i sin väg).
- När fisken simmar fritt återhämtar den avstånd: `recover` m/s.
- Krock med hinder: fisken blinkar/studsar, saktar in 1,0 s, `gap -= crashPenalty`. Kort osårbarhet 0,8 s efter krock. Skärmskak.
- Hajen kan själv krocka med hinder (slumpas per hinder hajen passerar med `sharkCrashChance`): hajen snurrar till, `gap += 1,5`, text "Hajen krockade! +50" och +50 p.

Per level L (1–7):
| L | Miljö | Längd s | Scroll px/s* | recover m/s | crashPenalty m | sharkCrashChance |
|---|---|---|---|---|---|---|
| 1 | Lagunen | 35 | 1,00 | 0,50 | 1,2 | 0,40 |
| 2 | Korallrevet | 40 | 1,12 | 0,42 | 1,6 | 0,30 |
| 3 | Vraket | 44 | 1,24 | 0,35 | 2,0 | 0,22 |
| 4 | Kelpskogen | 48 | 1,36 | 0,30 | 2,5 | 0,15 |
| 5 | Isgrottan | 52 | 1,48 | 0,25 | 3,0 | 0,10 |
| 6 | Vulkanrevet | 56 | 1,60 | 0,20 | 3,5 | 0,06 |
| 7 | Djuphavet | 60 | 1,72 | 0,15 | 4,0 | 0,03 |
| ∞ | Oändligt (miljöerna roterar var 30:e s) | ∞ | +0,04 var 10:e s | 0,12 | 4,5 | 0,02 |
*multipel av basfart = 0,55 × skärmbredd per sekund. Hindertätheten ökar också inom levlen (första 5 s lugnt) och mellan levlar. Från level 3 finns rörliga hinder (guppar upp/ned), från level 5 smala passager. Generera alltid en framkomlig väg (kontrollera att det finns en lucka ≥ 1,8 × fiskens höjd som fisken hinner nå med sin vertikala hastighet).

## Miljöer och hinder (ett tema per level, egen bakgrund + hinderfärger)
1. Lagunen – ljust turkosblått vatten, sand, stenar och sjögräs.
2. Korallrevet – koraller (rosa/orange), maneter (lila, guppar), stenar.
3. Vraket – vrakdelar, ankare, rostiga kedjor från ytan, tunnor.
4. Kelpskogen – höga kelpstjälkar från botten och toppen, gröna.
5. Isgrottan – istappar från taket, isblock, kallt ljusblått.
6. Vulkanrevet – mörka lavastenar med glödande sprickor, bubbelpelare.
7. Djuphavet – nästan svart, sikten begränsad till en ljuskägla runt fisken, självlysande taggiga stenar och marulk-lyktor.

## Plockbart
- **Pärlor**: 10 p × levelmultiplikator. Ligger i bågar/linjer som lockar till risk.
- **Pärl-serie**: pärlor i rad utan krock: ×2 vid 10, ×3 vid 25 (visas "SERIE ×2"). Nollställs vid krock.
- Power-ups (dyker upp var 8–12 s, max 1 på skärmen, cirkel med ikon och glöd):
  - **Turbo** (blixt, `#3CE0B4`): 3 s, fisken snabbare, gap +0,8 m/s extra, fartstreck.
  - **Sköld** (sköld, `#6FB3FF`): skyddar mot nästa krock, max 8 s. Bubbla runt fisken.
  - **Magnet** (magnet, `#FFC83D`): 6 s, pärlor inom ~30 % av skärmbredden dras till fisken.
  - **Bläckmoln** (bläckplump, `#B48CFF`): hajen får bläck i ögonen 4 s, gap +0,6 m/s extra, hajen ritas med mörkt moln.

## Poäng
- Överlevnad: 10 p/s × (1 + 0,25 × (L−1)).
- Pärlor enligt ovan. Hajkrock +50.
- Level klar: 250 × L. Utan krock: +300 extra.
- Stjärnor: 1 = klarad, 2 = ≤ 2 krockar, 3 = 0 krockar.
- Flytande texter för poäng ("+10", "SERIE ×2", "LEVEL-BONUS +500").

## Uppäten-animationer (slumpa, aldrig samma två gånger i rad, inget blod, tecknat)
1. **Halva fisken**: hajen hugger av fisken; främre halvan seglar sakta ned mot botten och snurrar, bubblor; bakre halvan försvinner i käften.
2. **Hel munsbit**: hajen slukar fisken, sväljer ("gulp"), en stor bubbla rapas upp.
3. **Fiskbenet**: hajen sveper förbi, bara ett fiskskelett blir kvar och dalar ned.
4. **Luftfärden**: hajen knuffar upp fisken som snurrar uppåt mot ytan och nappas i luften.
5. **Svansnappet**: hajen biter tag i svansen och skakar fisken fram och tillbaka innan den drar iväg ut ur bild.
Slow motion (0,3× tid) och lätt inzoomning under början. Text "UPPÄTEN!" glider in.

## Fiskar (endast utseende, ingen skillnad i egenskaper)
12 st: Blixt (orange/vit), Neon (cyan), Ninja (mörkgrå med röd rand), Guldis (gul), Lavendel (lila), Mint (turkos) – öppna. Låsta: Tiger (randig, 1 000 p), Zebra (svart-vit, 2 500 p), Korall (rosa, nå level 4), Natt (mörkblå med ljusprickar, 5 000 p), Regnbåge (flerfärgad, nå level 7), Kristall (genomskinlig/glittrande, 10 000 p). Upplåsning baseras på personbästa / högsta level i localStorage. Visa "Ny fisk upplåst!" på game over när något låses upp.

## Topplista (utan inloggning)
Modul `leaderboard.js` med samma API för två lägen:
- `window.HAJ_CONFIG = { supabaseUrl: "", supabaseAnonKey: "" }` högst upp i index.html.
- Tomma → **lokalt läge** (localStorage, bara denna enhet), liten text "Topplistan är lokal på den här enheten tills den kopplas upp".
- Ifyllda → Supabase REST (fetch, inga bibliotek): `POST {url}/rest/v1/scores` med headers `apikey`, `Authorization: Bearer <key>`, `Content-Type: application/json`, `Prefer: return=minimal`. Hämta: `GET {url}/rest/v1/scores?select=nick,score,level,fish,created_at&order=score.desc&limit=50` plus `&created_at=gte.<ISO>` för Idag (lokal midnatt) / Veckan (senaste 7 dygn).
- Placering: `GET ...?select=id&score=gt.<poäng>` med `Prefer: count=exact` → läs `Content-Range` för att räkna antal bättre → plats.
- Timeout 6 s, felhantering: visa "Topplistan kunde inte laddas" och fortsätt fungera.
- Bifoga `supabase.sql` som skapar tabellen `scores (id bigint identity pk, nick text check 3–12 tecken, score int check 0–2000000, level int check 1–99, fish text, created_at timestamptz default now())`, aktiverar RLS och tillåter anon `insert` och `select` men inte update/delete.
- Spara bara en rad per avslutad runda.

## Ljud (WebAudio-syntes, inga ljudfiler)
Starta AudioContext vid första tryck. Effekter: pearl, turbo, shield, magnet, ink, crash, sharkCrash, chomp, gulp, levelup, click, record, countdown, go. Enkel loopande musik per level (arpeggio + bas, tempot ökar med level, lite mer spänning nära hajen). Ljud av/på sparas i localStorage.

## Teknik
- `<canvas>` för spelet, DOM för menyer. requestAnimationFrame med delta-tid (cap 50 ms). devicePixelRatio max 2. Ska flyta på en mellanklassmobil.
- `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">`, respektera safe-area insets.
- localStorage-nycklar prefixas `haj_`. Allt i try/catch.
- Inga externa nätverksanrop förutom Google Fonts och Supabase.

## Kontrakt mellan moduler

### `src/art.js` → `window.Art`
```
Art.FISH            // [{id, name, unlock: null | {type:'score'|'level', value, label:'1 000 p'}}] i ordningen ovan
Art.LEVELS          // [{name:'Lagunen', ...valfri palettdata}] längd 7
Art.drawFish(ctx, x, y, size, fishId, t, opts)   // x,y = mitt; size = kroppslängd px; opts: {part:'whole'|'front'|'back'|'skeleton', angle:rad, alpha, flash:bool}
                                                 // fisken vänd åt höger; svansen viftar med t (sekunder)
Art.drawShark(ctx, x, y, size, t, opts)          // vänd åt höger; opts: {mouth:0..1, angle, inked:bool, dizzy:bool}
Art.drawBackground(ctx, w, h, levelIndex, scrollX, t)   // parallax-lager, ljusstrålar, partiklar, botten; levelIndex 0–6
Art.drawDarkness(ctx, w, h, cx, cy, radius)      // för level 7: mörker utom ljuskägla
Art.drawObstacle(ctx, ob, levelIndex, t)         // ob = {kind, x, y, w, h, seed}; ritas inom sin hitbox (x,y = övre vänstra hörnet)
Art.OBSTACLE_KINDS  // per levelIndex: [{kind, from:'bottom'|'top'|'free', minH, maxH, minW, maxW, moving:bool}]
Art.drawPearl(ctx, x, y, r, t)
Art.drawPowerup(ctx, type, x, y, r, t)           // type: 'turbo'|'shield'|'magnet'|'ink'
Art.drawShield(ctx, x, y, r, t)                  // bubbla runt fisken
Art.drawInkCloud(ctx, x, y, r, t)
Art.drawBubble(ctx, x, y, r, alpha)
Art.fishIconDataURL(fishId, w, h)                // PNG data-URL för menyer/topplistan (rita på offscreen canvas)
```
### `src/audio.js` → `window.Sfx`
```
Sfx.unlock()            // anropas vid första användargest
Sfx.play(name)          // namnen ovan
Sfx.music(levelIndex)   // starta/byt loop; levelIndex 0–6, 7 = oändligt
Sfx.tension(0..1)       // hur nära hajen är
Sfx.stopMusic()
Sfx.setMuted(bool); Sfx.muted
```
Spelkoden får inte anta mer än kontraktet. Om `window.Art`/`window.Sfx` saknas ska spelet ändå starta med enkla ersättare.
