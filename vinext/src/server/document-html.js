// Splice the rendered page, collected head tags and scripts into a custom
// _document's markup at the markers next/document's Head, Main and
// NextScript leave.
const marker = (name) => `<vinext-marker data-marker="${name}"></vinext-marker>`;

export function fillDocument(markup, { head, main, scripts }) {
  return markup
    .replace(marker("head"), () => head)
    .replace(marker("main"), () => `<div id="__next">${main}</div>`)
    .replace(marker("scripts"), () => scripts);
}
