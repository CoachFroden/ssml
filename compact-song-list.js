function loadCompactListStyles() {
  if (document.querySelector('link[data-ssml-compact-list]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./compact-song-list.css?v=1', import.meta.url).href;
  link.dataset.ssmlCompactList = 'true';
  document.head.append(link);
}

function buildMeta(composer, arranger) {
  const parts = [];
  if (composer && composer !== '–') parts.push(composer);
  if (arranger && arranger !== '–') parts.push(`arr. ${arranger}`);
  return parts.join(' · ');
}

function compactSongList() {
  const shell = document.querySelector('#song-list-shell');
  if (!shell || shell.querySelector('.compact-song-list')) return;

  const rows = [...shell.querySelectorAll('.song-list-table tbody tr')];
  if (!rows.length) return;

  const list = document.createElement('div');
  list.className = 'compact-song-list';

  rows.forEach(row => {
    const titleButton = row.querySelector('[data-open-song]');
    if (!titleButton) return;

    const cells = [...row.querySelectorAll('td')];
    const composer = cells[2]?.textContent?.trim() || '';
    const arranger = cells[3]?.textContent?.trim() || '';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'compact-song-row';
    button.dataset.openSong = titleButton.dataset.openSong;

    const title = document.createElement('span');
    title.className = 'compact-song-title';
    title.textContent = titleButton.textContent?.trim() || 'Utan tittel';

    const metaText = buildMeta(composer, arranger);
    if (metaText) {
      const meta = document.createElement('span');
      meta.className = 'compact-song-meta';
      meta.textContent = metaText;
      button.append(title, meta);
    } else {
      button.append(title);
    }

    list.append(button);
  });

  if (list.childElementCount) shell.replaceChildren(list);
}

function observeSongList() {
  const view = document.querySelector('#list-view');
  if (!view) {
    setTimeout(observeSongList, 100);
    return;
  }

  const observer = new MutationObserver(() => compactSongList());
  observer.observe(view, { childList: true, subtree: true });
  compactSongList();
}

loadCompactListStyles();
observeSongList();
