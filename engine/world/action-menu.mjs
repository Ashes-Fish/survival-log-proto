// Furniture action menu: the buttons come from Config_FurnitureFunc, exactly like the
// original's furniture interaction bar.
export function createActionMenu(container, {onPick, onStory, onClose}) {
  container.innerHTML = '';
  container.classList.remove('on');
  let cleanup = null;

  function hide() {
    container.classList.remove('on');
    container.innerHTML = '';
    if (cleanup) { cleanup(); cleanup = null; }
    onClose?.();
  }

  function show(anchor, buttons) {
    container.innerHTML = '';
    container.classList.remove('story');
    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = anchor.name;
    container.appendChild(title);

    buttons.forEach((button) => {
      const item = document.createElement('button');
      item.className = 'menu-item';
      item.innerHTML = '<span class="label"></span>' + (button.tip ? '<span class="tip"></span>' : '');
      item.querySelector('.label').textContent = button.label;
      if (button.tip) item.querySelector('.tip').textContent = button.tip;
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        hide();
        onPick(anchor, button);
      });
      container.appendChild(item);
    });

    const close = document.createElement('button');
    close.className = 'menu-close';
    close.textContent = '关闭';
    close.addEventListener('click', (event) => { event.stopPropagation(); hide(); });
    container.appendChild(close);

    container.classList.add('on');
    const onKey = (event) => { if (event.key === 'Escape') hide(); };
    addEventListener('keydown', onKey);
    cleanup = () => removeEventListener('keydown', onKey);
  }

  // Config_Story popup: title, description, quote and one confirm button. The confirm
  // button reuses .menu-item so existing checks can click it the same way.
  function showStory(anchor, story) {
    container.innerHTML = '';
    container.classList.add('story');
    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = story.title;
    container.appendChild(title);
    for (const [cls, text] of [['story-body', story.body], ['story-quote', story.quote]]) {
      if (!text) continue;
      const node = document.createElement('div');
      node.className = cls;
      node.textContent = text;
      container.appendChild(node);
    }
    const confirm = document.createElement('button');
    confirm.className = 'menu-item story-confirm';
    confirm.innerHTML = '<span class="label"></span>';
    confirm.querySelector('.label').textContent = story.button;
    confirm.addEventListener('click', (event) => {
      event.stopPropagation();
      container.classList.remove('on', 'story');
      container.innerHTML = '';
      if (cleanup) { cleanup(); cleanup = null; }
      onStory?.(anchor, story);
    });
    container.appendChild(confirm);
    container.classList.add('on');
    const onKey = (event) => { if (event.key === 'Escape') { container.classList.remove('story'); hide(); } };
    addEventListener('keydown', onKey);
    cleanup = () => removeEventListener('keydown', onKey);
  }

  return {show, showStory, hide, isOpen: () => container.classList.contains('on')};
}
