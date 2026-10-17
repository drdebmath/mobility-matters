# Changelog

Versions are dated; the website footer and the book's title page show the current one.

## 2026-10-17 — ring exploration, oriented grids and two-robot models

- **Exploration by oblivious robots.** Ring results corrected and completed: separate
  lower bounds with their scope (4 robots, 5 for even $n$, impossible when $k \mid n$,
  $\Omega(\log n)$), new axes for the scheduler, randomness and goal, and new settings for
  SSYNC rings, probabilistic SSYNC rings and exclusive perpetual ring exploration.
- **Dispersion.** A grid orientation axis; oriented grids reach $O(\sqrt k)$ time with
  $O(\log k)$ memory (preprint), and the crash and Byzantine grid settings are placed by
  orientation. The tree now splits by topology and orientation before faults.
- **Robots in the plane.** The two-robot landscape is complete: 29 new relations, three
  new separating tasks, and incomparability now carries over to equivalent models.
- 20 new references.

## 2026-10-14 — redesign, glossaries and a reorganised book

- **Reading.** Problem pages read as chapters: a contents rail, then statement, first
  look, *What is known* (one row per setting with its best bounds and how tight they are),
  all open questions grouped by setting, history, relations, perspectives and the case tree.
- **Design.** Serif text in a 75-character column, fewer boxes, quieter colours, a
  light/dark switch, larger figures with stronger lines and frame labels above the
  drawing, a play/pause button, figures that respect "reduce motion", and pages that stay
  readable if a CDN library fails to load.
- **Words.** Every problem has a glossary; its summary, statement, primer and figure use
  those words and define each at first use. Map construction, near-gathering and pattern
  sequences received corrections found on the way.
- **Notation.** In partitioning, $k$ is the number of groups (each of $n/k$ robots); in
  chauffeuring the number of exits is $e$.
- **Findable.** Every problem, setting, model and perspective has its own address (for
  example `problem/dispersion/base/`) with the page already in the HTML, so search engines
  and language models can read and cite it; a full sitemap, `llms.txt` and
  `llms-full.txt` (the whole atlas as text). The home page shows when the atlas was last
  updated, and the single-file offline build now works without a connection.
- **Book.** Figures redrawn as TikZ figures in a paper's style; each problem has a drawn
  case tree, a *What is known* table and lighter setting sections; citations no longer
  produce double parentheses.

## 2026-10-12 — first public version

- 51 problems in four models (mobile agents on graphs, mobile robots in the plane,
  search in geometric domains, programmable matter), each with an assumption tree,
  bounds, sources and open questions.
- Every assumption axis with its origin and formal definition; per-model notation
  and an index of assumptions.
- A first look (plain-language primer) for every problem; ten perspectives.
- Explore by assumptions; search; notation page; acknowledgements.
- The book `mobility-matters.pdf`, generated from the same data.
- Contributions through GitHub issues; weekly search for new papers.
