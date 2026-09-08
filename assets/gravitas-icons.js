/* ==========================================================================
   GRAVITAS+ WORKSPACE ICONS
   Twenty-nine marks for the product interface, drawn to the same geometry as the
   sixteen in the brand book (section 11) so the workspace and the public site
   speak with one hand.

   These replace two foreign vocabularies that had grown into the workspace:
   a vendored subset of Lucide, and a scattering of Unicode geometric glyphs
   (U+25C7 as "Overview", U+2191 as "Files", U+2659 — a chess pawn — as
   "Team"). Both were disagreeing with the brand set and with each other, and
   the glyphs additionally rendered at whatever weight and baseline the user's
   font stack happened to supply.

   Every mark here was fitted by the book's own procedure rather than eyeballed:
   rasterised, its ink centroid solved onto (12, 12), scaled until the ink
   extent reaches the common optical cap of 19.6 units, and given a
   counter-scaled stroke-width so it still draws at 1.7 whatever its transform.
   That is why no two scale or stroke-width attributes below match. The accent
   dot, where a mark carries one, is re-cut to 3.1 units across in the final
   frame, as the book requires — except where the solid shape is structural
   (a figure's head, a node in a graph), which keeps the size it was drawn at.

   Marks for THINGS carry the accent dot. Marks for ACTIONS (plus, arrow,
   close, check, search…) do not, which is the same split the brand book makes
   between the product set and the interface set.

   Sizes: 1.25rem or smaller in the interface, as the book specifies. Never on
   a plate — the plate is reserved for the six public section marks.
   ==========================================================================*/
(function () {
  'use strict';

  var marks = {
    home: "<g transform=\"translate(0.241 -1.483) scale(0.980000)\" stroke-width=\"1.735\"><path d=\"M3 10.2 12 3l9 7.2\"/><path d=\"M5.2 12v8.2a1 1 0 0 0 1 1h11.6a1 1 0 0 0 1-1V12\"/><circle cx=\"12\" cy=\"16.4\" r=\"1.582\" fill=\"currentColor\" stroke=\"none\"/></g>",
    overview: "<g transform=\"translate(0.647 0.325) scale(0.946052)\" stroke-width=\"1.797\"><rect x=\"2.6\" y=\"3.4\" width=\"18.8\" height=\"17.2\" rx=\"4\"/><path d=\"M2.6 9.4h18.8\"/><path d=\"M13.4 14.2h5\"/><path d=\"M13.4 17.4h3\"/><circle cx=\"7.6\" cy=\"15.8\" r=\"1.638\" fill=\"currentColor\" stroke=\"none\"/></g>",
    projects: "<g transform=\"translate(0.758 -0.858) scale(0.968270)\" stroke-width=\"1.756\"><path d=\"M2.8 6.4a2 2 0 0 1 2-2h4.3a2 2 0 0 1 1.6.8l1 1.4a2 2 0 0 0 1.6.8h5.9a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H4.8a2 2 0 0 1-2-2z\"/><circle cx=\"12\" cy=\"14.4\" r=\"1.601\" fill=\"currentColor\" stroke=\"none\"/></g>",
    notes: "<g transform=\"translate(1.586 0.550) scale(0.889943)\" stroke-width=\"1.910\"><path d=\"M5.6 3.6a1.6 1.6 0 0 1 1.6-1.6h6.2l5 5v13.4a1.6 1.6 0 0 1-1.6 1.6H7.2a1.6 1.6 0 0 1-1.6-1.6z\"/><path d=\"M13.4 2v5h5\"/><path d=\"M9.2 12.6h5.6\"/><path d=\"M9.2 15.8h3.4\"/><circle cx=\"9.6\" cy=\"19\" r=\"1.742\" fill=\"currentColor\" stroke=\"none\"/></g>",
    files: "<g transform=\"translate(0.650 1.082) scale(0.945894)\" stroke-width=\"1.797\"><rect x=\"2.6\" y=\"4.4\" width=\"18.8\" height=\"15.2\" rx=\"3.2\"/><path d=\"M2.6 11.2h18.8\"/><path d=\"M9.4 4.4V2.6h5.2v1.8\"/><circle cx=\"12\" cy=\"15.4\" r=\"1.639\" fill=\"currentColor\" stroke=\"none\"/></g>",
    datasets: "<g transform=\"translate(0.715 -0.207) scale(0.968270)\" stroke-width=\"1.756\"><rect x=\"2.8\" y=\"3.6\" width=\"18.4\" height=\"16.8\" rx=\"3.2\"/><path d=\"M2.8 9.2h18.4\"/><path d=\"M2.8 14.8h18.4\"/><path d=\"M12 9.2v11.2\"/><circle cx=\"7.4\" cy=\"17.6\" r=\"1.601\" fill=\"currentColor\" stroke=\"none\"/></g>",
    collaboration: "<g transform=\"translate(1.073 1.079) scale(0.906898)\" stroke-width=\"1.875\"><circle cx=\"8.6\" cy=\"12\" r=\"6.4\"/><circle cx=\"15.4\" cy=\"12\" r=\"6.4\"/><circle cx=\"12\" cy=\"12\" r=\"1.709\" fill=\"currentColor\" stroke=\"none\"/></g>",
    team: "<g transform=\"translate(0.645 0.673) scale(0.945894)\" stroke-width=\"1.797\"><path d=\"M2.6 20.4v-1.7a4.6 4.6 0 0 1 4.6-4.6h3.4a4.6 4.6 0 0 1 4.6 4.6v1.7\"/><path d=\"M17 14.4a4.6 4.6 0 0 1 4.4 4.6v1.4\"/><path d=\"M16.2 4.2a3.5 3.5 0 0 1 0 6.8\"/><circle cx=\"8.9\" cy=\"7.4\" r=\"3.5\" fill=\"currentColor\" stroke=\"none\"/></g>",
    tasks: "<g transform=\"translate(0.996 0.562) scale(0.945752)\" stroke-width=\"1.798\"><path d=\"M2.6 6.4 4.4 8.2 8 4.6\"/><path d=\"M11.4 6.4h10\"/><path d=\"M11.4 12h10\"/><path d=\"M11.4 17.6h10\"/><path d=\"M2.6 12h3.6\"/><circle cx=\"4.4\" cy=\"17.6\" r=\"1.639\" fill=\"currentColor\" stroke=\"none\"/></g>",
    content: "<g transform=\"translate(-0.333 0.397) scale(0.949432)\" stroke-width=\"1.791\"><path d=\"M7.4 2.6h8.4a2 2 0 0 1 2 2v11.8a2 2 0 0 1-2 2H7.4a2 2 0 0 1-2-2V4.6a2 2 0 0 1 2-2z\"/><path d=\"M8.8 21.4h8.6a3 3 0 0 0 3-3V7.6\"/><path d=\"M9.2 7.4h4.8\"/><circle cx=\"9.8\" cy=\"11.4\" r=\"1.633\" fill=\"currentColor\" stroke=\"none\"/></g>",
    planning: "<g transform=\"translate(0.794 0.673) scale(0.946052)\" stroke-width=\"1.797\"><path d=\"M2.6 18.4h18.8\"/><path d=\"M6.2 18.4V9.6\"/><path d=\"M12 18.4V4.6\"/><path d=\"M17.8 18.4v-6.2\"/><circle cx=\"6.2\" cy=\"7.4\" r=\"1.5\"/><circle cx=\"17.8\" cy=\"10\" r=\"1.5\"/><circle cx=\"12\" cy=\"2.6\" r=\"1.638\" fill=\"currentColor\" stroke=\"none\"/></g>",
    mindmap: "<g transform=\"translate(1.321 2.143) scale(0.893620)\" stroke-width=\"1.902\"><circle cx=\"4.4\" cy=\"6\" r=\"2.4\"/><circle cx=\"19.6\" cy=\"6\" r=\"2.4\"/><circle cx=\"12\" cy=\"20.4\" r=\"2.4\"/><path d=\"M6.4 7.4 10.6 11.6\"/><path d=\"M17.6 7.4 13.4 11.6\"/><path d=\"M12 14.8v3.2\"/><circle cx=\"12\" cy=\"12.8\" r=\"1.735\" fill=\"currentColor\" stroke=\"none\"/></g>",
    storage: "<g transform=\"translate(0.381 0.574) scale(0.968270)\" stroke-width=\"1.756\"><path d=\"M4.4 4.6a1.8 1.8 0 0 1 1.8-1.8h11.6a1.8 1.8 0 0 1 1.8 1.8v14.8a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8z\"/><path d=\"M4.4 13.6h15.2\"/><circle cx=\"12\" cy=\"8\" r=\"1.601\" fill=\"currentColor\" stroke=\"none\"/></g>",
    activity: "<g transform=\"translate(0.957 -0.750) scale(0.949771)\" stroke-width=\"1.790\"><path d=\"M2.6 14.6h3.8l2.4-7.2 3.4 12 2.8-9.2 1.8 4.4h4.6\"/></g>",
    share: "<g transform=\"translate(-1.224 0.329) scale(0.972384)\" stroke-width=\"1.748\"><circle cx=\"18.4\" cy=\"5.4\" r=\"2.6\"/><circle cx=\"18.4\" cy=\"18.6\" r=\"2.6\"/><path d=\"M7.6 10.8 16 6.6\"/><path d=\"M7.6 13.2 16 17.4\"/><circle cx=\"5.6\" cy=\"12\" r=\"2.6\" fill=\"currentColor\" stroke=\"none\"/></g>",
    secure: "<g transform=\"translate(0.739 -0.407) scale(0.938477)\" stroke-width=\"1.811\"><rect x=\"3.6\" y=\"10.2\" width=\"16.8\" height=\"11.2\" rx=\"3\"/><path d=\"M7.4 10.2V7a4.6 4.6 0 0 1 9.2 0v3.2\"/><circle cx=\"12\" cy=\"15.8\" r=\"1.652\" fill=\"currentColor\" stroke=\"none\"/></g>",
    target: "<g transform=\"translate(0.332 0.331) scale(0.968448)\" stroke-width=\"1.755\"><circle cx=\"12\" cy=\"12\" r=\"9.2\"/><circle cx=\"12\" cy=\"12\" r=\"4.8\"/><circle cx=\"12\" cy=\"12\" r=\"1.600\" fill=\"currentColor\" stroke=\"none\"/></g>",
    cycle: "<g transform=\"translate(-1.028 0.184) scale(1.038200)\" stroke-width=\"1.637\"><path d=\"M20.4 12a8.4 8.4 0 1 1-2.9-6.35\"/><path d=\"M20.8 3.2v5.2h-5.2\"/><circle cx=\"12\" cy=\"12\" r=\"1.493\" fill=\"currentColor\" stroke=\"none\"/></g>",
    meeting: "<g transform=\"translate(0.225 0.531) scale(0.968286)\" stroke-width=\"1.756\"><circle cx=\"12\" cy=\"12\" r=\"9.2\"/><path d=\"M12 6.6V12l3.8 2.4\"/></g>",
    plus: "<g transform=\"translate(-2.099 -2.094) scale(1.174958)\" stroke-width=\"1.447\"><path d=\"M12 4.4v15.2\"/><path d=\"M4.4 12h15.2\"/></g>",
    arrow: "<g transform=\"translate(-2.850 -0.453) scale(1.033855)\" stroke-width=\"1.644\"><path d=\"M3.4 12h17.2\"/><path d=\"m14.2 5.6 6.4 6.4-6.4 6.4\"/></g>",
    external: "<g transform=\"translate(-8.982 -3.969) scale(1.533503)\" stroke-width=\"1.109\"><path d=\"M6.2 17.8 17.8 6.2\"/><path d=\"M8.6 6.2h9.2v9.2\"/></g>",
    close: "<g transform=\"translate(-3.700 -3.704) scale(1.313744)\" stroke-width=\"1.294\"><path d=\"m5.2 5.2 13.6 13.6\"/><path d=\"m18.8 5.2-13.6 13.6\"/></g>",
    chevron: "<g transform=\"translate(-3.054 -2.465) scale(1.209200)\" stroke-width=\"1.406\"><path d=\"m9 4.6 7.4 7.4L9 19.4\"/></g>",
    check: "<g transform=\"translate(-0.793 -1.901) scale(1.060362)\" stroke-width=\"1.603\"><path d=\"m3.6 12.6 5.6 5.6L20.4 6.4\"/></g>",
    search: "<g transform=\"translate(0.287 0.291) scale(1.000150)\" stroke-width=\"1.700\"><circle cx=\"10.6\" cy=\"10.6\" r=\"7.4\"/><path d=\"m16 16 5 5\"/></g>",
    more: "<g transform=\"translate(0.048 0.047) scale(1.000167)\" stroke-width=\"1.700\"><circle cx=\"12\" cy=\"4.6\" r=\"1.55\"/><circle cx=\"12\" cy=\"12\" r=\"1.55\"/><circle cx=\"12\" cy=\"19.4\" r=\"1.55\"/></g>",
    filter: "<g transform=\"translate(0.380 2.683) scale(0.968399)\" stroke-width=\"1.755\"><path d=\"M2.8 5.2h18.4\"/><path d=\"M6.2 12h11.6\"/><path d=\"M9.6 18.8h4.8\"/></g>",
    theme: "<g transform=\"translate(-1.799 0.002) scale(1.000000)\" stroke-width=\"1.700\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 3a9 9 0 0 1 0 18z\" fill=\"currentColor\" stroke=\"none\"/></g>"
  };

  /* One <svg> wrapper for every mark: fill and stroke inherit currentColor so
     the row, button or plate decides the colour, never the icon. */
  function icon(name, cls) {
    var g = marks[name] || marks.overview;
    return '<svg class="' + (cls || 'g-wi') + '" viewBox="0 0 24 24" aria-hidden="true" ' +
      'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ' +
      'shape-rendering="geometricPrecision">' + g + '</svg>';
  }

  function has(name) { return Object.prototype.hasOwnProperty.call(marks, name); }

  window.GravitasIcons = { icon: icon, has: has, names: Object.keys(marks) };
})();
