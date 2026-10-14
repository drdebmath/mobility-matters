# Mobility Matters

*A Living Survey of Open Problems on Autonomous Agents, Robots and Particles*

**Website:** https://drdebmath.github.io/mobility-matters/ · **Book (PDF):** [mobility-matters.pdf](mobility-matters.pdf)

Mobility Matters is a public atlas of research problems in distributed computing by
mobile entities: agents moving on graphs, robots in the plane, robots searching
geometric domains, and programmable matter. For every problem it records the
precise statement and, for each setting (a set of assumptions), the proven lower
bounds and what forces them, the paper that introduced the setting, the current
best result, how far apart they are, and what is still open. It currently covers
51 problems, 282 settings and 389 papers.

## How it is organised

- **Model › family › problem › assumption tree.** Each problem's tree starts from
  no assumptions and adds them one axis at a time (timing, faults, communication,
  …), so results carry over: algorithms towards stronger assumptions, lower
  bounds towards weaker ones.
- **Assumptions with their history.** Every axis says where the assumption comes
  from and why the community studies it; the notation and an index of every
  assumption with its formal definition are on the Notation page.
- **A first look.** Every problem opens with a plain-language explanation, a
  simple algorithm with its analysis, and the main impossibility, for newcomers.
- **Perspectives.** Essays that connect problems across models.
- **Explore and search.** Pick a model and assumptions to see what is known there.

## Contributing

Found a mistake, a missing result or a missing problem? Open an issue:
[suggest a result](https://github.com/drdebmath/mobility-matters/issues/new?template=new-result.yml),
[report an error](https://github.com/drdebmath/mobility-matters/issues/new?template=error.yml),
[suggest a problem](https://github.com/drdebmath/mobility-matters/issues/new?template=new-problem.yml).
Every submission is checked against the full text of the paper; accepted
contributions are acknowledged on the site and in the book. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Citing

Please cite the atlas as a whole (see `CITATION.cff`, or "Cite this as" on the
website); for a result, cite the paper the atlas gives for it.

## Running and building

```sh
python3 -m http.server 8765              # then open http://localhost:8765
python3 scripts/validate.py              # data schema and references
node scripts/render-check.js             # every page renders, no LaTeX errors
python3 scripts/check-refs.py            # DOIs, arXiv ids and titles against Crossref/arXiv
python3 scripts/build-pdf.py             # the book (needs LuaLaTeX)
zsh scripts/weekly.sh                    # weekly search for new papers (see AGENTS.md)
```

The site is static (`index.html`, `assets/`, `data/`). A GitHub Action deploys it to
GitHub Pages and adds a crawlable page for every problem and setting, `sitemap.xml`,
`llms.txt` and `llms-full.txt` (`bash scripts/build-site.sh` builds the same in
`build/site`). `AGENTS.md` describes the data schema and every convention.

## Licence

Text and data: [CC BY 4.0](LICENSE-CONTENT.md). Code: [MIT](LICENSE).
AI use: Claude (Anthropic) assisted in cataloguing; see the Acknowledgements.
