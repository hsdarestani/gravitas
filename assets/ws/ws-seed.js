/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  STARTING CONTENT
   The pages a new or signed-out workspace opens with. This is not filler to
   make screenshots look busy: it is the editorial work the site itself is
   built from, so somebody opening the workspace cold sees the real shape of
   a Gravitas dossier rather than lorem ipsum in a tree.

   Two of these pages are phantoms, which is deliberate. A knowledge base
   where every link resolves is a knowledge base nobody has worked in yet,
   and the phantom state is the one piece of the model that has to be seen
   to be understood.
   ========================================================================== */

const iso = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

const b = (type, text, extra = {}) => ({
  id: 'b-' + Math.random().toString(36).slice(2, 9),
  type, text, ...extra,
});

export const seed = {
  /* The tree. Flat with parent pointers rather than nested, because the
     editor needs to find one page by id far more often than it needs to
     walk a branch, and nesting makes that a search. */
  nodes: [
    /* ---- Research space ------------------------------------------------
       `space` is only carried by the roots. A child inherits it from its
       parent, resolved once when the tree is read, because a note that is
       moved between branches should change workspace by being moved rather
       than by somebody remembering to rewrite a second field on it. */
    { id: 'journal',   title: 'Journal',            kind: 'folder', parent: null, space: 'research', phantom: false },
    { id: 'dossiers',  title: 'Dossiers',           kind: 'folder', parent: null, space: 'research', phantom: false },
    { id: 'd-cu',      title: 'Computable Universe', kind: 'folder', parent: 'dossiers', phantom: false },
    { id: 'cu-brief',  title: 'Editorial brief',     kind: 'note',   parent: 'd-cu',     phantom: false },
    { id: 'cu-sources', title: 'Source ladder',      kind: 'note',   parent: 'd-cu',     phantom: false },
    { id: 'cu-against', title: 'The case against',   kind: 'note',   parent: 'd-cu',     phantom: false },
    { id: 'd-mh',      title: 'Machine Hypothesis',  kind: 'folder', parent: 'dossiers', phantom: false },
    { id: 'mh-brief',  title: 'Editorial brief',     kind: 'note',   parent: 'd-mh',     phantom: false },
    { id: 'mh-sim',    title: 'Simulation notes',    kind: 'note',   parent: 'd-mh',     phantom: false },
    { id: 'method',    title: 'Method',              kind: 'folder', parent: null, space: 'research', phantom: false },
    { id: 'm-corr',    title: 'Correction log',      kind: 'note',   parent: 'method',   phantom: false },
    { id: 'm-depth',   title: 'The depth switch',    kind: 'note',   parent: 'method',   phantom: false },

    /* Written about, not yet written. */
    { id: 'ph-falsif', title: 'Falsification budget', kind: 'note',  parent: 'method',   phantom: true },
    { id: 'ph-lorenz', title: 'Lorenz parameters',    kind: 'note',  parent: 'd-mh',     phantom: true },

    /* ---- Core space ----------------------------------------------------
       What the team writes while running the company. Three roots, and the
       split between them is the one that keeps this branch usable: a
       meeting produces Meetings, a meeting that ends in a decision produces
       Decisions, and a decision that has to bind future work produces a
       Standard, which is the draft a blueprint is later cut from. */
    { id: 'c-meetings',  title: 'Meetings',            kind: 'folder', parent: null, space: 'core', phantom: false },
    { id: 'c-weekly',    title: 'Weekly · production',  kind: 'note',   parent: 'c-meetings', phantom: false },
    { id: 'c-decisions', title: 'Decisions',            kind: 'folder', parent: null, space: 'core', phantom: false },
    { id: 'c-dec-depth', title: 'One workspace, three spaces', kind: 'note', parent: 'c-decisions', phantom: false },
    { id: 'c-standards', title: 'Standards',            kind: 'folder', parent: null, space: 'core', phantom: false },
    { id: 'c-std-owner', title: 'One owner per task',    kind: 'note',   parent: 'c-standards', phantom: false },
    { id: 'c-ph-brief',  title: 'Content brief template', kind: 'note',  parent: 'c-standards', phantom: true },

    /* ---- Knowledge space ------------------------------------------------
       Durable knowledge, filed by what it is rather than by what it was
       for. Concepts are the things themselves; Methods are how to do
       something; Field notes are what happened when we tried. */
    { id: 'k-concepts',  title: 'Concepts',            kind: 'folder', parent: null, space: 'kms', phantom: false },
    { id: 'k-spaced',    title: 'Spaced repetition',    kind: 'note',   parent: 'k-concepts', phantom: false },
    { id: 'k-bayes',     title: 'Evidence and priors',  kind: 'note',   parent: 'k-concepts', phantom: false },
    { id: 'k-methods',   title: 'Methods',              kind: 'folder', parent: null, space: 'kms', phantom: false },
    { id: 'k-distil',    title: 'How to distil a source', kind: 'note', parent: 'k-methods',  phantom: false },
    { id: 'k-field',     title: 'Field notes',          kind: 'folder', parent: null, space: 'kms', phantom: false },
    { id: 'k-ph-interf', title: 'Interference and forgetting', kind: 'note', parent: 'k-concepts', phantom: true },
  ],

  pages: {
    'cu-brief': {
      id: 'cu-brief', title: 'Editorial brief', kind: 'note', parent: 'd-cu',
      created: iso(31), updated: iso(2),
      blocks: [
        b('h2', 'What the dossier has to answer'),
        b('p', 'Whether the universe is computable is not one question. It is three, and readers who arrive from the film reliably conflate them. The brief is to keep them apart on the page without making the separation feel like a lecture.'),
        b('ul', 'Is physical law computable in the Church-Turing sense\nIs the universe running on something\nCould we tell from inside either way'),
        b('p', 'Only the third is empirical, and it is the one the essay should spend its length on. The other two set it up.'),
        b('h2', 'Depth handling'),
        b('p', 'The overview version carries the argument and stops. The in-depth version adds the halting-problem construction and the three primary citations. Neither is a teaser for the other. See [[The depth switch]].'),
        b('h2', 'Open'),
        b('p', 'The falsifiability section is still soft. We claim the hypothesis is testable and then hedge for a paragraph, which is the worst of both. Decide before layout, and write it up as [[Falsification budget]].'),
        b('code', 'from mpmath import mp\nmp.dps = 60\n# digit-sequence check on the discretisation bound\n# holds to 1e-42 across the sampled interval', { lang: 'python' }),
      ],
    },

    'cu-sources': {
      id: 'cu-sources', title: 'Source ladder', kind: 'note', parent: 'd-cu',
      created: iso(29), updated: iso(6),
      blocks: [
        b('p', 'Three rungs, as the dossier template requires. A reader should be able to stop after any one of them and have gained something whole.'),
        b('h3', 'Start here'),
        b('p', 'Two popular treatments, both of which state the hypothesis without overselling it. Neither is a paper, and that is the point of the rung.'),
        b('h3', 'Go further'),
        b('p', 'Review literature. This rung is where the reader meets the disagreement for the first time, so the annotations matter more than the list.'),
        b('h3', 'Primary'),
        b('p', 'Four papers. Two argue the position, two argue against it, and the balance is deliberate. See [[The case against]].'),
        b('attach', 'discretisation-bounds-2026.pdf', { kind: 'PDF', meta: '14 pages · annotated' }),
      ],
    },

    'cu-against': {
      id: 'cu-against', title: 'The case against', kind: 'note', parent: 'd-cu',
      created: iso(28), updated: iso(9),
      blocks: [
        b('h2', 'The strongest version, stated fairly'),
        b('p', 'House rule: this page is written as though we believed it. If the argument here is weaker than the one a good opponent would make, the dossier has failed its own editorial standard and the layer is worthless.'),
        b('p', 'The strongest objection is not philosophical, it is about measurement. Every proposed signature of discreteness sits below the noise floor of any instrument we can presently build, which makes the hypothesis unfalsifiable in practice while remaining falsifiable in principle. That distinction does real work and we should not paper over it.'),
        b('p', 'Related: [[Falsification budget]].'),
      ],
    },

    'mh-brief': {
      id: 'mh-brief', title: 'Editorial brief', kind: 'note', parent: 'd-mh',
      created: iso(22), updated: iso(1),
      blocks: [
        b('h2', 'The lesson is the interaction, not the text'),
        b('p', 'The 2-4-6 task teaches confirmation bias better than any paragraph about confirmation bias, provided we resist explaining it first. The simulation goes above the essay, and the essay reads as a debrief.'),
        b('p', 'We count confirming versus falsifying tests and show the ratio at the end. Most players discover they spent their effort trying to be right rather than trying to be wrong, which is the whole point and lands only if unannounced.'),
        b('h2', 'Physics skin'),
        b('p', 'The Lorenz pair runs two identical systems started a hair apart. Parameters are in [[Lorenz parameters]] once measured.'),
      ],
    },

    'mh-sim': {
      id: 'mh-sim', title: 'Simulation notes', kind: 'note', parent: 'd-mh',
      created: iso(20), updated: iso(4),
      blocks: [
        b('p', 'Divergence is visible at roughly nine seconds of simulated time at the current separation, which is slow enough that readers leave before it happens. Options are a larger initial separation, a faster clock, or a trace that marks the moment.'),
        b('p', 'Preference is the trace. Speeding the clock makes chaos look like a rendering artefact.'),
        b('code', 'sigma = 10\nrho   = 28\nbeta  = 8 / 3\ndt    = 0.004        # below this the trail reads as a solid line\nsep   = 1e-9         # initial separation between the two bodies', { lang: 'python' }),
        b('attach', 'lorenz-divergence.webm', { kind: 'VIDEO', meta: '00:24 · screen capture' }),
      ],
    },

    'm-corr': {
      id: 'm-corr', title: 'Correction log', kind: 'note', parent: 'method',
      created: iso(48), updated: iso(3),
      blocks: [
        b('p', 'Public, permanent, and linked from every dossier. A correction log that lives in a drawer is a press office, not a method.'),
        b('h3', 'Open'),
        b('p', 'The discretisation bound quoted in the Computable Universe essay came from the review rather than the primary paper, and the review rounded it. Correct against the original and note the change. Raised by Aurélie Fontaine.'),
        b('h3', 'Closed'),
        b('p', 'Timeline entry for 1936 conflated the submission and publication dates. Fixed, logged, and the entry now carries both.'),
      ],
    },

    'm-depth': {
      id: 'm-depth', title: 'The depth switch', kind: 'note', parent: 'method',
      created: iso(45), updated: iso(11),
      blocks: [
        b('h2', 'Why not a section for researchers'),
        b('p', 'A separate researcher section splits the audience at the door, halves the value of every piece, and asks people to classify themselves before they know what is inside. The switch re-renders the page in place instead, and the choice persists across pages.'),
        b('p', 'The rule that makes it work: neither version is a teaser. Both are the whole argument, at different resolutions. The moment the overview becomes an advertisement for the depth version, readers stop trusting the switch.'),
      ],
    },

    /* ---- Core ----------------------------------------------------------- */

    'c-weekly': {
      id: 'c-weekly', title: 'Weekly · production', kind: 'note', parent: 'c-meetings',
      created: iso(7), updated: iso(7),
      blocks: [
        b('h2', 'Decided'),
        b('ul', 'Content Studio Blueprint goes to approval as v0.2 rather than waiting for section 16\nProduction keeps shared section ownership, single ownership per task\nMeasurement reports monthly, not per asset'),
        b('h2', 'Carried'),
        b('p', 'The brief template is still three different documents depending on who starts it. Written up as [[Content brief template]] and owned by whoever writes the next brief.'),
        b('p', 'Full reasoning for the workspace split is in [[One workspace, three spaces]].'),
      ],
    },

    'c-dec-depth': {
      id: 'c-dec-depth', title: 'One workspace, three spaces', kind: 'note', parent: 'c-decisions',
      created: iso(5), updated: iso(2),
      blocks: [
        b('h2', 'The decision'),
        b('p', 'Core, Research and Knowledge are three workspaces in one shell, not three products. They share the editor, the link graph, the search index and the assistant. What they do not share is the tree, because the tree is the part a person has to hold in their head.'),
        b('h2', 'Why not one Notes section'),
        b('p', 'We tried it. Within a month the tree held a client deliverable, a payroll question and somebody’s reading notes on attention, sorted by nothing. The cost is not tidiness, it is retrieval: you stop opening the tree because you do not expect to find anything in it.'),
        b('h2', 'What crosses the line'),
        b('p', 'A page moves between spaces by being moved, and the move is deliberate. A research note becomes a knowledge note when the project it served is finished and the lesson survives it. See [[How to distil a source]].'),
      ],
    },

    'c-std-owner': {
      id: 'c-std-owner', title: 'One owner per task', kind: 'note', parent: 'c-standards',
      created: iso(26), updated: iso(12),
      blocks: [
        b('p', 'A section of a blueprint may be owned by two people. A task may not. Shared task ownership reliably produces the state where both owners believe the other one is doing it, and that state is invisible on a board until the deadline passes.'),
        b('p', 'Production in the Content Studio Blueprint is the standing example: the section is Kiarash and Ahmad, and every task cut from it names exactly one of them.'),
      ],
    },

    /* ---- Knowledge ------------------------------------------------------- */

    'k-spaced': {
      id: 'k-spaced', title: 'Spaced repetition', kind: 'note', parent: 'k-concepts',
      created: iso(60), updated: iso(8),
      blocks: [
        b('h2', 'The claim'),
        b('p', 'Recall is strengthened more by retrieving a fact at the edge of forgetting it than by reading it again while it is still fresh. The interval, not the repetition, is what does the work.'),
        b('h2', 'Why the workspace schedules rather than lists'),
        b('p', 'A list of everything you have learned is a list you never open. A queue of the six things you are about to forget is a queue you can finish before coffee. Recall & Review shows the second and never the first.'),
        b('h2', 'Open question'),
        b('p', 'Whether interference explains more of the forgetting curve than decay does. Written up as [[Interference and forgetting]] once the reading is done.'),
      ],
    },

    'k-bayes': {
      id: 'k-bayes', title: 'Evidence and priors', kind: 'note', parent: 'k-concepts',
      created: iso(40), updated: iso(15),
      blocks: [
        b('p', 'The useful half of Bayes for editorial work is not the arithmetic. It is the habit of asking what you believed before the paper arrived, and by how much this paper should move you. A study that could not have changed your mind either way has told you nothing, however large its sample.'),
        b('p', 'This is the same standard the dossiers apply in [[The case against]], arrived at from the other direction.'),
      ],
    },

    'k-distil': {
      id: 'k-distil', title: 'How to distil a source', kind: 'note', parent: 'k-methods',
      created: iso(35), updated: iso(3),
      blocks: [
        b('h2', 'Four passes, and the fourth is the only one that counts'),
        b('ul', 'Capture the source with the question you opened it for\nMark only what answers that question\nClose the source, then write the answer from memory\nLink the note to what it contradicts, not only to what it supports'),
        b('p', 'Writing from memory with the source closed is the whole method. A note copied out of an open paper feels like understanding and tests as nothing, which is why Recall & Review exists.'),
        b('p', 'The forgetting model behind the schedule is in [[Spaced repetition]].'),
      ],
    },
  },

};
