(() => {
  const body = document.body;
  const helpDrawer = document.getElementById('hq-help-drawer');
  const search = document.getElementById('hq-global-search');

  function openNav() {
    body.classList.add('hq-nav-open');
  }
  function closeNav() {
    body.classList.remove('hq-nav-open');
  }
  function openHelp() {
    body.classList.add('hq-help-open');
    if (helpDrawer) helpDrawer.setAttribute('aria-hidden', 'false');
  }
  function closeHelp() {
    body.classList.remove('hq-help-open');
    if (helpDrawer) helpDrawer.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-nav-open]').forEach((button) => button.addEventListener('click', openNav));
  document.querySelectorAll('[data-nav-close]').forEach((button) => button.addEventListener('click', closeNav));
  document.querySelectorAll('[data-help-open]').forEach((button) => button.addEventListener('click', openHelp));
  document.querySelectorAll('[data-help-close]').forEach((button) => button.addEventListener('click', closeHelp));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeNav();
      closeHelp();
    }
    if (event.key === '/' && search && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      search.focus();
    }
  });

  document.querySelectorAll('[data-auto-submit]').forEach((control) => {
    control.addEventListener('change', () => control.form && control.form.submit());
  });

  document.querySelectorAll('[data-row-link]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('a, button, input, select, textarea, label')) return;
      window.location.href = row.dataset.rowLink;
    });
    row.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('a, button, input, select, textarea')) {
        event.preventDefault();
        window.location.href = row.dataset.rowLink;
      }
    });
  });
})();
