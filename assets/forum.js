/* ==========================================================================
   GRAVIQUEST FORUM · THREAD  (forum-thread.html)
   The position control beside the posts: the Start Here rail's count and
   round arrows, used the way a forum's timeline is. The count follows the
   post in view; the arrows step to the previous or next post. Without this
   script the arrows are plain links to #post-1 and #post-2, so the page
   still works, it only stops following the reader.
   The list page (forum.html) needs nothing from here: site.js runs its room
   filter and search, as it does on Topics.
   ========================================================================== */
(function () {
  'use strict';
  var posts = document.querySelectorAll('.fm-post');
  var count = document.querySelector('[data-fm-count]');
  var prev = document.querySelector('[data-fm-prev]');
  var next = document.querySelector('[data-fm-next]');
  if (!posts.length || !count || !prev || !next) return;
  var n = posts.length, at = 0;
  var pad = function (v) { return (v < 10 ? '0' : '') + v; };

  function show(i) {
    at = i;
    count.textContent = pad(i + 1) + ' / ' + pad(n);
    prev.setAttribute('href', '#post-' + Math.max(1, i));
    next.setAttribute('href', '#post-' + Math.min(n, i + 2));
    prev.setAttribute('aria-disabled', String(i === 0));
    next.setAttribute('aria-disabled', String(i === n - 1));
  }
  function go(i, e) {
    e.preventDefault();
    if (i < 0 || i >= n) return;
    posts[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
    show(i);
  }
  prev.addEventListener('click', function (e) { go(at - 1, e); });
  next.addEventListener('click', function (e) { go(at + 1, e); });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) show([].indexOf.call(posts, en.target));
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    [].forEach.call(posts, function (p) { io.observe(p); });
  }
  show(0);
})();
