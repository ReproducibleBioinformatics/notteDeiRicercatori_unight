# The map of people

An interactive installation built for European Researchers' Night at the Molecular
Biotechnology Center, University of Turin.

Visitors answer ten multiple-choice questions on their phone. Their answers become a point
on a map projected on a big screen, next to everyone else who answered that evening. The
map alternates between a PCA and a UMAP view of the same data, which is the whole point:
two projections of the same forty-dimensional space that tell you different things.

It is a dimensionality-reduction lesson where the data points are the audience.

![PCA and UMAP side by side](docs/anteprima.png)

---

## What actually happens

Ten questions, four options each. One-hot encoded, that is forty binary features: one slot
per possible answer, set to 1 if you picked it. Nobody can draw forty dimensions, so we go
down to two, twice, in two different ways.

**PCA** finds the two directions along which people differ the most and projects everyone
onto them, like the shadow of an object on a wall. It is a linear map, faithful to large
distances, and it flattens everything else. On this data the first two components carry
about 18% of the variance — low, and that is exactly why the PCA view looks like one big
smudge with gradients rather than separate groups.

**UMAP** optimises for something else: keep near neighbours near. Distances between groups
stop meaning much, but the groups themselves come apart into islands.

Put those two views next to each other and the trade-off explains itself without a single
equation. The bridge to what the lab actually does is one sentence long: replace the ten
questions with twenty thousand genes and the person with a cell, and this is a single-cell
RNA-seq embedding.

---

## The hard part: a map that holds still

The obvious implementation refits the projection every time somebody answers. It does not
work. Every point jumps, the cluster colours reshuffle, and the visitor who answered two
minutes ago is somewhere else now. The illusion of "here is where you belong" dies
immediately.

So nothing is ever refitted. `tools/build_model.py` runs **once, offline** and freezes a
map:

1. It generates a synthetic reference population of 1200 respondents, drawn from six
   archetypes with a fixed random seed.
2. It runs PCA on that population and keeps the mean vector and the loadings — an 8×40
   matrix.
3. It runs UMAP on the principal component scores and keeps the 2D coordinates of all 1200
   reference points.
4. It computes the six cluster centroids in PC space.

All of it goes into `shared/model.js`. At runtime the server only does arithmetic:

- answers → one-hot vector of 40 numbers;
- subtract the stored mean, multiply by the stored loadings → PCA coordinates, fully
  deterministic;
- nearest stored centroid → cluster id, and therefore colour;
- for UMAP, which has no closed-form transform, place the new point at the weighted average
  of the UMAP coordinates of its 15 nearest reference points.

The consequence is the property the installation needs: **as long as `shared/model.js` is
unchanged, the map and the six colours are identical for the first visitor and the four
hundredth.** Two people who answer identically land on the same spot, every time, by
construction rather than by luck.

The reference cloud stays visible on screen as a faint background. It gives the map its
shape when only a handful of real people have answered, so the screen is never empty.

Regenerating the model invalidates everything stored before it — the saved coordinates
refer to a map that no longer exists. The deploy script detects this and offers to wipe the
database.

## The questions are not a personality test

They are a device for producing separable clusters out of a crowd, and they are throwaway:
morning routine, ideal weekend, how you tackle a problem, state of your desk, music,
holidays, dinner, public speaking, superpower, dream experiment.

The six archetypes — Explorers, Architects, Contemplatives, Creative mess, Social magnets,
Serial curious — are defined by a preferred option per question plus a purity parameter
controlling how consistently they follow it. Sampling from them produces genuine cluster
structure rather than a uniform blob, which is what makes the PCA-versus-UMAP contrast
legible on a screen from five metres away.

Nearest-centroid assignment currently recovers the true archetype for 92% of the reference
population. Below roughly 85% the clusters overlap too much to read at a distance.

---

## Architecture

Cloudflare Pages for the static pages, Pages Functions for the API, D1 for the evening's
participant list. No build step, no framework, no bundler — the pages are plain HTML and
ES modules, the plot is a canvas.

| Route | What it is |
|---|---|
| `/` | the projected screen: map, QR code, counter, legend |
| `/quiz` | what opens when you scan the QR |
| `/qr` | an oversized QR to print for the table |
| `/api/questions` | the ten questions |
| `/api/model` | the reference cloud and the legend, for the display |
| `/api/submit` | answers in, coordinates out, row written |
| `/api/points?since=N` | everything newer than id N |
| `/api/reset` | wipes the table, admin token required |

```
public/            what the browser gets
  index.html         big screen
  quiz.html          phone
  qr.html            printable QR
  assets/            css, display and quiz logic, QR library
functions/api/       the endpoints above
shared/
  model.js           GENERATED: loadings, UMAP reference, centroids
  questions.js       GENERATED: the questions
  project.js         new answers -> coordinates, no fitting
  http.js            JSON replies, name sanitising, IP hashing
tools/
  build_model.py     the script that generates the two GENERATED files
schema.sql           the D1 table
wrangler.toml        Cloudflare config
deploy.ps1           publish (Windows)
```

The display polls `/api/points` every two seconds asking only for rows newer than the
highest id it already has, so the query usually reads zero rows and the cost stays flat as
the evening fills up. The last ten arrivals keep their name drawn on the map; labels that
would collide slide vertically until they find room. The newest one also gets a pulsing
ring for twenty seconds.

### On screen

`P` for PCA, `U` for UMAP, space to toggle, `F` for fullscreen, click anywhere to switch.
Left alone it alternates every 45 seconds with a 1.5 s eased morph, which is the moment
worth watching: the same points sliding from one projection to the other.

---

## Running it

Needs a Cloudflare account (free tier is enough), Node 18+, and — only if you want to
change the questions — Python with `numpy` and `umap-learn`.

```bash
npm install
npx wrangler login
npx wrangler d1 create notte-ricercatori     # put the printed id in wrangler.toml
npm run db:remote                            # create the table
npx wrangler pages project create <project-name>
npx wrangler pages deploy
```

`name` in `wrangler.toml` must match the Pages project name exactly, lowercase with dashes.

Two variables want real values, set as secrets rather than committed:

```bash
npx wrangler pages secret put HASH_SALT      # salts the IP hashes used for rate limiting
npx wrangler pages secret put ADMIN_TOKEN    # guards /api/reset
```

`npm run dev` runs the whole thing locally against a local D1 file. The QR will encode
`localhost`, which your phone cannot reach — bind to your LAN address
(`wrangler pages dev --ip 0.0.0.0`) and open the display at that IP if you want to test the
scan.

### deploy.ps1

One command instead of four, for Windows.

```powershell
.\deploy.ps1 "message"                # commit, push, deploy
.\deploy.ps1 "new questions" -Modello # regenerate the model first
.\deploy.ps1 -SoloDeploy              # publish without touching git
.\deploy.ps1 -Svuota                  # clear participants
```

It reads the project and database names out of `wrangler.toml`, so there is nothing to
configure. With `-Modello` it hashes `shared/model.js` before and after regenerating: if the
map actually changed it says so and offers to wipe the database, because leaving old rows
around would scatter people across coordinates that no longer mean anything.

Note that pushing to GitHub does not deploy by itself. This project is published directly
with `wrangler pages deploy`; wiring Pages to the repository for automatic builds works too,
as long as the Pages project is created from the Pages tab rather than the Workers one.

---

## Changing the questions

Everything is in `tools/build_model.py`: the `QUESTIONS` list and the `ARCHETYPES` list.

For each archetype, `pref` holds one zero-based option index per question — the answer that
archetype typically gives — and `purity` (0 to 1) is how often it actually gives it. Raise
purity and the clusters separate further; lower it and they blend. The number of entries in
every `pref` must equal the number of questions, and each index must be valid for its
question.

```bash
pip install -r tools/requirements.txt
python3 tools/build_model.py
```

The script prints the variance explained by the first two components and the
nearest-centroid recovery rate. Watch the second one. Then redeploy and wipe the database.

Question count and options per question are both free to change; the rest of the code reads
the shape from the model. Adding a seventh archetype means adding a seventh `color`, which
the legend and the plot both read from there.

---

## Cost and privacy

Everything sits inside Cloudflare's free tier. The screen consumes roughly 43,000 Function
requests per 24 hours of continuous polling against a 100,000/day allowance, plus a handful
per participant. Multiple simultaneous displays multiply that — raise `POLL_MS` in
`display.js` if you run three of them all day.

Stored per participant: the name they typed, which can be anything, their ten answers,
their coordinates, and a truncated salted hash of their IP used solely to rate-limit one
submission per twelve seconds. No cookies, no analytics, no third-party requests beyond the
webfonts. Run the reset at the end of the night and nothing remains.

The questions and the interface are in Italian, since that is the audience they were
written for.

---

Built at the [Molecular Biotechnology Center](https://www.mbc.unito.it/), University of
Turin. QR encoding by
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT.
