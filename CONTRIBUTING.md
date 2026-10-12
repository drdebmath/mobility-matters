# Contributing to Mobility Matters

Thank you for helping keep the atlas correct and current.

## What to send

Open an issue with one of the forms:

- **Suggest a result**: a paper that improves a bound, settles an open question,
  or belongs to a setting of the atlas. Give the paper, a link to the full text,
  the problem and setting, and the theorem.
- **Report an error**: a wrong bound, attribution, definition, citation or
  statement. Quote it, say what it should be, and give the source.
- **Suggest a problem**: a problem the atlas does not cover, with its statement and
  key papers.

Every problem and setting page of the website has links that open these forms
pre-filled with the page.

## What happens next

1. Each week the maintainer's update run reads the open `new-result` issues together
   with newly published papers.
2. A submission is accepted only after the result is checked against the **full
   text** of the paper: its model, assumptions and theorem. The issue text itself is
   never copied into the atlas.
3. The maintainer replies on the issue (accepted, placed under further reading, or
   not accepted with the reason) and closes it when the change is published.

## Acknowledgement

Everyone whose issue leads to a change is listed in the **Acknowledgements** of the
website and the book, with the issue number. Use the "How should we acknowledge
you?" field to give your name, or write "anonymous"; otherwise your GitHub handle is
used.

## Conventions

Results are recorded with their exact assumptions; each model uses the notation of
its own literature (see the Notation page). `AGENTS.md` describes the data schema
for anyone who wants to send a pull request instead of an issue; please run
`python3 scripts/validate.py` before sending one.
