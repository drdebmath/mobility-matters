# Changelog

What changed in each version of the atlas, newest first. Versions are dated; the website
footer and the book's title page show the current one.

## 2026-11-02 — Every version of every paper, eight new problems

References now list every version of a paper with its own links, eight problems are new,
and a search for papers that the bibliography lacked added settings and results across
the atlas.

### New problems

- **Online exploration of weighted graphs.** One agent with unbounded memory, measured
  against a shortest tour (7 settings). The competitive ratio is between 4 and
  $O(\log n)$ in general and constant on graphs that exclude a fixed minor. On weighted
  cycles the deterministic ratio is exactly $(1+\sqrt3)/2$ (Miyazaki, Morimoto and Okabe),
  and a randomized agent does better. Known graphs with weight estimates have settings of
  their own.
- **Gathering by oblivious robots on graphs.** Look–Compute–Move robots on rings,
  hypercubes, the infinite grid, finite grids, trees, complete graphs and graphs that are
  not vertex-transitive, with round robin as an activation order. On finite grids and
  trees no multiplicity detection is needed (D'Angelo, Di Stefano, Klasing and Navarra).
  On complete graphs under FSYNC with strong multiplicity detection the setting follows
  Cicerone, Di Stefano and Navarra, whose lower bound is proved only for a Fibonacci prime
  number of robots. A computer-assisted proof shows that four robots on a ring of seven
  nodes cannot gather asynchronously (D'Emidio, Di Stefano, Frigioni and Navarra).
- **Broadcast by agents in dynamic graphs.** How many agents spread a message when an
  adversary changes the graph every round (7 settings).
- **Search for a moving target.** One or two robots on the line or on $m$ rays, by what
  they know of the target's distance and speed (28 settings). The eight one-robot cases of
  Coleman, Kranakis, Krizanc and Morales-Ponce were read in full. A robot that knows the
  distance but not the speed of a target moving away has ratio $(1-u)^{-4+o(1)}$, and no
  strategy achieves $O((1-u)^{-4+\varepsilon})$ (Coleman, Ivanov, Kranakis, Krizanc and
  Morales-Ponce).
- **Collision-free exploration.** Agents that may never share a node: from labelled graphs
  with a map ($\Theta(n\Delta^*)$ rounds) to two identical agents in anonymous graphs,
  which need vision of radius 2 or coloured pebbles (10 settings).
- **Deciding graph properties by mobile agents.** Which properties of their start
  configuration agents in an anonymous graph can decide (7 settings). After Fraigniaud and
  Pelc (decision against verification with a certificate, and a complete problem for
  verification), Bampas and Ilcinkas (finer classes), and Izumi et al. (one bit of agent
  memory with constant-size whiteboards decides as much as $O(n)$ bits).
- **Delivery by energy-constrained agents.** Agents with budgets carry a message from a
  source to a target, handing it over (5 settings). Delivery is strongly NP-hard even on
  unweighted graphs with equal budgets (Chalopin, Das, Mihalák, Penna and Widmayer, who
  posed the problem) and on planar graphs, weakly NP-hard on a path, and linear on a path
  with equal budgets; a budget factor of 3 is tight unless P = NP. Returning delivery, a
  fixed path and energy exchange are described in the notes.
- **Uniform deployment on graphs.** Agents on distinct nodes must end evenly spread
  (3 settings). On a dynamic ring one agent can be blocked forever, so all but one spread,
  with an optimal number of moves (Shibata, Sudo, Nakamura and Kim).

Each new problem has *A first look* for newcomers and an animated figure that follows a
paper's algorithm or argument step by step.

### New settings and results

- **Exploration.** Single-agent exploration of T-interval-connected graphs with node
  identifiers. Temporal exploration with a known schedule gains new bounds, among them
  $O(\sigma n\log^3 n)$ steps for always-connected temporal graphs, where $\sigma$ is the
  number of 2-dimensional Weisfeiler–Leman colour classes (Kammer, Kiefer and Meintrup; a
  preprint). Exploration of dynamic graphs gains graphs that stay connected at every step:
  $2m-n+1$ silent agents suffice and $m-n+1$ are needed (Dobrev, Královič and Pardubská).
  In directed graphs the notes now cite Bender and Slonim (two cooperating agents learn
  any unlabelled digraph in expected polynomial time), Kutten (who introduced the
  deficiency of a digraph) and Foerster and Wattenhofer (visiting every node rather than
  every arc).
- **Collaborative exploration.** An axis for a team that must occupy a connected set of
  nodes in every round, with a setting for Mutzari, Aumann and Kraus.
- **Exploration by oblivious robots.** With Devismes's protocol for rings of five to eight
  nodes, four probabilistic robots explore every ring of more than four nodes and stop.
- **Black hole search.** Dynamic graphs with whiteboards. An axis for a black hole that may
  appear at any time, even at the home base: three synchronous agents are necessary and
  sufficient on an oriented ring, asynchronous agents cannot announce the location once
  and for all (Bonnet, Bramas and Lamani), and four agents suffice on arbitrary graphs
  (Kaur, Saxena, Mandal and Mondal).
- **Decontamination.** Monotone decontamination of dynamic graphs.
- **Rendezvous.** Paths with labelled nodes, with the lower bound of Miller and Pelc. Two
  settings for labelled agents in infinite trees (Bhagat and Pelc): exponential in the
  distance with arbitrary delay, $O(d\log L)$ in oriented trees with simultaneous start.
- **Treasure hunt.** Dynamic graphs.
- **Gathering.** On graphs, new bounds for weakly Byzantine agents. In the plane:
  self-stabilizing gathering with two colours; FSYNC gathering without multiplicity
  detection; an axis for restricted initial configurations, with crash-tolerant gathering
  in ASYNC from a restricted start; and robots that agree on one axis and tolerate any
  number of crashes, even when they block each other's view (Bhagat, Gan Chaudhuri and
  Mukhopadhyaya).
- **Scattering.** Asynchronous scattering with weak multiplicity detection, and with blind
  robots and rigid moves (a preprint of Léchine and Tixeuil).
- **Mutual visibility.** Mobility faults under a movement budget; one bit of internal
  memory.
- **Pattern formation.** With chirality, the atlas cites the characterisation of Cicerone,
  Di Stefano and Navarra (its journal paper), which replaces the disputed algorithm of
  Fujinaga et al.
- **Patrolling.** Fence patrolling by robots with distinct speeds is settled on the segment
  (almost twice the length of partition) and on the one-way circle (unboundedly more than
  the cyclic strategy) by Haeupler, Kuhn, Martinsson, Petrova and Pfister.
- **Search.** Randomized search on $m$ rays.
- **Programmable matter.** A communication axis (local, or reconfigurable circuits) and a
  synchronous scheduler: with circuits, stationary particles elect a leader in $O(\log n)$
  rounds with high probability (Feldmann, Padalkin, Scheideler and Dolev; Warner and
  Scheideler). Stationary randomized leader election, and new bounds for shape formation
  by an agent with tiles.
- **Models and perspectives.** The sequential schedulers of Feletti, Flocchini, Prencipe and
  Santoro join the landscape of robot models. The perspective on weak robots gains the
  scheduler hierarchy on graphs, a certified link between continuous and discrete moves,
  and fault detection.

### Corrections

- **Rendezvous.** Anonymous agents that start with a delay can meet even from symmetric
  nodes once the delay reaches a threshold (Pelc and Yadav); this corrects the note of that
  setting.
- **Separation.** The figure caption credited the asynchronous algorithm (separation into
  parallel lines) to Seike and Yamauchi, who solved the synchronous case; it is due to
  Flocchini et al.
- **Exploration of directed graphs with one pebble.** Checked against the full text of
  Fraigniaud and Ilcinkas: the memory lower bound is proved for perpetual exploration and
  holds even with up to $n$ pebbles, and the one-pebble algorithm needs no knowledge of $n$
  but takes exponential time; polynomial time is reached with $O(\log\log n)$ pebbles.
- **Robots in the plane.** A quotation that the model attributed to Défago et al.
  (Distributed Computing 2020) comes from Clément et al. only.
- **Gathering on rings.** Model checking found deadlocks in a published ring-gathering
  algorithm (Doan, Bonnet and Ogata; in further reading).

### References

- **Which version is cited.** A paper is cited by its journal version; without one, by its
  full conference version; with only a brief announcement or short paper, by that. Every
  reference was looked up in Crossref, DataCite, arXiv and HAL: 29 now cite another version
  (25 a journal version), 177 list their other versions (156 of them with a DOI), and 11
  gained their arXiv preprint. Coleman et al. (JCSS 2026), Bampas et al. (Algorithmica 2017)
  and two papers of Cicerone et al. are also cited by their journal versions. Kim, Katayama
  and Wada's journal version states a weaker time bound than their preprint, so the two have
  separate entries.
- **Links.** Each version has its own links, including a direct link to an open PDF
  (LIPIcs, HAL, open-access journals, arXiv) where one exists: 92 PDF links besides the
  arXiv ones.
- **Preprints.** Results and lower bounds from the 18 papers that exist only as preprints
  are marked *preprint* on the site and in the book.
- **Dates.** The timeline dates a paper by its first appearance in any form; for 86 papers
  an earlier arXiv preprint or conference version moves it earlier. Four conference papers
  now carry the year of the meeting, not of the proceedings.
- **Version read.** Where the version checked is not the cited one, the reference says
  which it was (158 references, mostly arXiv versions).
- **Repeated versions.** Two references listed one version twice (the PODC 2002 paper of
  Dobrev, Flocchini, Prencipe and Santoro, which ACM registered under two DOIs, and the
  Intelligent Computing 2023 paper of Das et al.); the two SSRN postings of Adamson et al.
  now carry their months.
- **A search for missing papers.** The works of the watched authors and the topics of every
  problem were searched; 564 papers were missing from the bibliography. Those that could be
  obtained were read and placed: the new settings and results above, and more than 250
  papers in further reading. Among them: two agents meet in an always-connected temporal
  graph with a known schedule in $O(n\log^3 n)$ steps (Kammer, Kiefer and Meintrup); black
  hole search with verification in dynamic graphs (Kaur and Saxena); safe exploration of
  temporally connected graphs with any number of black holes (Feletti, Flocchini, Prencipe
  and Santoro); multi-agent rotor-routers; treasure hunt in the plane and with quantum
  pebbles; black hole search in dynamic tori and cactus graphs; map construction by a
  painting agent; energy-constrained exploration; and near-gathering.
- **Directed graphs.** Seven papers on directed graphs joined the bibliography. Further
  reading gains black hole search in directed graphs, where some instances need a number of
  agents exponential in the in-degree of the black hole and synchrony changes how many are
  needed (Czyzowicz, Dobrev, Královič, Miklík and Pardubská; Kosowski, Navarra and
  Pinotti); learning a finite automaton without a reset by homing sequences (Rivest and
  Schapire); and log-space universal traversal sequences for regular digraphs with
  consistent labels (Reingold, Trevisan and Vadhan).

### Site and book

- This changelog is a page of the site.
- The references page filters by model, role in the atlas (posed the problem, introductory
  result, current best, lower bound, further reading, and others) and kind of publication;
  each entry says which models and problems cite it, in what role and in which settings.
  Every model page ends with its papers, listed by problem.
- Papers that share an author–year label are told apart by a letter (2020a, 2020b) on the
  site, as in the book.
- The book opens with an abstract page; the abstract describes the settings as a directed
  acyclic graph.
- In the repository, each problem file is in the folder of its family
  (`data/problems/<family>/<id>.json`).

## 2026-10-22 — Full texts checked, 26 new settings

100 papers that had been cited from abstracts or later surveys were read in full. About
70 "as reported" and "abstract only" remarks now cite the theorem directly, and 11 draft
settings are verified.

### Corrections

- One crash among three wireless robots in a disk needs at least
  $1+4\pi/3 \approx 5.188$, not $5.082$.
- The two-robot impossibility for grid exploration is proved only for visibility 1.
- With one common axis, robots in the plane only reach a segment of length 1; gathering at
  a point needs a compass.
- The rooted MIS algorithm by agents needs no knowledge of $n$ or $\Delta$.
- Three plane-robot settings now record the rigid moves their papers assume.

### New settings and results

- 26 new settings, among them priority and weighted evacuation on the line, disk
  evacuation and search with crash and Byzantine robots, triangles and squares with many
  wireless robots, terminating ring exploration with visibility 2, triangular grids,
  rotor-router with chosen pointers, one-way and two-way circle patrolling, event-driven
  scattering, MST from an arbitrary start, mutual visibility with crash faults and one
  axis, randomized pattern formation, and time-optimal gathering with a compass.
- Also: weighted evacuation on the disk; MIS from a rooted start without knowledge of $n$
  or $\Delta$; rotor-router lock-in in $O(m)$ when the designer knows the ports; and the
  counterexample of Dumitrescu, Ghosh and Tóth to the cyclic patrolling conjecture.

### Site and book

- The scattering figure follows the published rule.

## 2026-10-17 — Ring exploration, oriented grids and two-robot models

- **Exploration by oblivious robots.** Ring results corrected and completed: separate lower
  bounds with their scope (4 robots, 5 for even $n$, impossible when $k \mid n$,
  $\Omega(\log n)$); new axes for the scheduler, randomness and goal; and new settings for
  SSYNC rings, probabilistic SSYNC rings and exclusive perpetual ring exploration.
- **Dispersion.** An axis for the orientation of a grid. Oriented grids reach $O(\sqrt k)$
  time with $O(\log k)$ memory (a preprint), and the crash and Byzantine grid settings are
  placed by orientation. The case tree now splits by topology and orientation before
  faults.
- **Robots in the plane.** The landscape of two-robot models is complete: 29 new
  relations, three new separating tasks, and incomparability now carries over to
  equivalent models.
- **References.** 20 new references.

## 2026-10-14 — Redesign, glossaries and a reorganised book

- **Reading.** Problem pages read as chapters: a contents rail, then the statement,
  *A first look*, *What is known* (one row per setting with its best bounds and how tight
  they are), all open questions grouped by setting, history, relations, perspectives and
  the case tree.
- **Design.** Serif text in a 75-character column, fewer boxes, quieter colours, and a
  light/dark switch. Figures are larger, with stronger lines, frame labels above the
  drawing and a play/pause button; they respect "reduce motion". Pages stay readable if a
  CDN library fails to load.
- **Words.** Every problem has a glossary; its summary, statement, primer and figure use
  those words and define each at first use. Map construction, near-gathering and pattern
  sequences received corrections found on the way.
- **Notation.** In partitioning, $k$ is the number of groups (each of $n/k$ robots); in
  chauffeuring the number of exits is $e$.
- **Findable.** Every problem, setting, model and perspective has its own address (for
  example `problem/dispersion/base/`) with the page already in the HTML, so search engines
  and language models can read and cite it. A full sitemap, `llms.txt` and
  `llms-full.txt` (the whole atlas as text). The home page shows when the atlas was last
  updated, and the single-file offline build works without a connection.
- **Book.** Figures redrawn as TikZ figures in a paper's style. Each problem has a drawn
  case tree, a *What is known* table and lighter setting sections. Citations no longer
  produce double parentheses.

## 2026-10-12 — First public version

- 51 problems in four models (mobile agents on graphs, mobile robots in the plane, search
  in geometric domains, programmable matter), each with an assumption tree, bounds,
  sources and open questions.
- Every assumption axis with its origin and formal definition; per-model notation and an
  index of assumptions.
- *A first look* (a plain-language primer) for every problem; ten perspectives.
- Explore by assumptions; search; a notation page; acknowledgements.
- The book `mobility-matters.pdf`, generated from the same data.
- Contributions through GitHub issues; a weekly search for new papers.
