# Changelog

Versions are dated; the website footer and the book's title page show the current one.

## 2026-10-22 — full texts checked, 26 new settings

- **Read in full.** 100 papers that had been cited from abstracts or later surveys were
  read; about 70 "as reported" and "abstract only" remarks now cite the theorem directly,
  and 11 draft settings are verified.
- **Corrections.** Among them: one crash among three wireless robots in a disk needs at
  least $1+4\pi/3 \approx 5.188$, not $5.082$; the two-robot impossibility for grid
  exploration is proved only for visibility 1; with one common axis, robots in the plane
  only reach a segment of length 1, and gathering at a point needs a compass; the rooted
  MIS algorithm by agents needs no knowledge of $n$ or $\Delta$; three plane-robot
  settings now record the rigid moves their papers assume.
- **New settings.** 26, among them priority and weighted evacuation on the line, disk
  evacuation and search with crash and Byzantine robots, triangles and squares with many
  wireless robots, terminating ring exploration with visibility 2, triangular grids,
  rotor-router with chosen pointers, one-way and two-way circle patrolling, event-driven
  scattering, MST from an arbitrary start, mutual visibility with crash faults and one
  axis, randomized pattern formation and time-optimal gathering with a compass.
- **Also.** Weighted evacuation on the disk, MIS from a rooted start without knowledge
  of $n$ or $\Delta$, rotor-router lock-in in $O(m)$ when the designer knows the ports,
  the counterexample of Dumitrescu, Ghosh and Tóth to the cyclic patrolling conjecture,
  and a scattering figure that follows the published rule.

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
