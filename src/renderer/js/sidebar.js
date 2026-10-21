// The Notion-style sidebar on the right: full names for every section, the
// Notes tree, and a hide / show toggle (also Ctrl+\, as in Notion).
//
// Its width is one custom property, --sb-w on <body>. Views and the habit bar
// read it for their right edge, so hiding the sidebar is one class flip and
// everything else flows into the space on the same spring.

const HIDDEN_KEY = 'ethos.sidebar.hidden';

function setHidden(hidden) {
  document.body.classList.toggle('sb-hidden', hidden);
  document.getElementById('sb-show').setAttribute('aria-hidden', String(!hidden));
  document.getElementById('sb-show').tabIndex = hidden ? 0 : -1;
  try { localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0'); } catch { /* not fatal */ }
}

export function initSidebar() {
  let hidden = false;
  try { hidden = localStorage.getItem(HIDDEN_KEY) === '1'; } catch { /* default: shown */ }
  setHidden(hidden);

  document.getElementById('sb-hide').addEventListener('click', () => setHidden(true));
  document.getElementById('sb-show').addEventListener('click', () => setHidden(false));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      setHidden(!document.body.classList.contains('sb-hidden'));
    }
  });
}
