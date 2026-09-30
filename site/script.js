const previews = {
  markup: {
    caption: 'A pink arrow is worth a thousand words.',
    alt: 'Skritch annotating a sample web design with a pink arrow and text',
  },
  layers: {
    caption: 'Two images. One canvas. Your call.',
    alt: 'Skritch editor with two image layers and a selected reference image',
  },
  crop: {
    caption: 'Just this image. Just the part you need.',
    alt: 'Skritch crop tool targeting an individual image layer inside a larger canvas',
  },
};
for (const button of document.querySelectorAll('[data-preview]')) {
  button.addEventListener('click', () => {
    const key = button.dataset.preview;
    const image = document.querySelector('#app-preview');
    image.src = `assets/preview-${key}.png`;
    image.alt = previews[key].alt;
    document.querySelector('#preview-caption').textContent = previews[key].caption;
    document
      .querySelectorAll('[data-preview]')
      .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  });
}
for (const button of document.querySelectorAll('[data-format]')) {
  button.addEventListener('click', () => {
    const format = button.dataset.format;
    document.querySelector('#file-format').textContent = format.toUpperCase();
    document.querySelector('#sample-name').textContent = `design-review.${format}`;
    document.querySelector('#demo-format').textContent = `${format.toUpperCase()} ▾`;
    document
      .querySelectorAll('[data-format]')
      .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  });
}
