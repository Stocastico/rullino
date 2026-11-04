// Filerobot Image Editor with rullino looks. Filerobot's filters are Konva filters looked up by name in
// `Konva.Filters`; konvaFilter() turns an edit document (a colour grade, a look) into one, so a look
// can be loaded by name from a saved design (`loadableDesignState`) or switched on while the editor runs
// (`updateStateFnRef`). No JSX, so the file runs as it is in any bundler.
import { konvaFilter } from '@rullino/konva';
import Konva from 'konva'; // keep the exact version Filerobot depends on: it must be the same copy
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import FilerobotImageEditor from 'react-filerobot-image-editor';

const lut = (id) => ({ version: 2, steps: [{ filter: 'applyLut', params: { look: { ref: `look:${id}` } } }] });
const looks = {
  RullinoNoir: ['Noir', lut('noir')],
  RullinoTealOrange: ['Teal & orange', lut('tealOrange')],
  // Not a look from the library: your own grade is a list of steps, as long as each one changes colours only.
  RullinoPunchy: ['Punchy', { version: 2, steps: [
    { filter: 'exposure', params: { ev: 0.2 } },
    { filter: 'contrast', params: { amount: 0.3 } },
    { filter: 'saturation', params: { amount: 0.35 } },
  ] }],
};
for (const [name, [, edit]] of Object.entries(looks)) Konva.Filters[name] = konvaFilter(edit);

// updateStateFnRef.current(...) changes Filerobot's design state from outside.
const update = { current: null };
const bar = document.querySelector('#looks');
for (const [name, [label]] of [...Object.entries(looks), ['', ['No look']]]) {
  const button = Object.assign(document.createElement('button'), { textContent: label });
  button.addEventListener('click', () => update.current({ filter: Konva.Filters[name] ?? null }));
  bar.append(button);
}

createRoot(document.querySelector('#editor')).render(
  createElement(FilerobotImageEditor, {
    source: new URL('./photo.jpg', import.meta.url).href,
    // A saved design names its filter: the same string works in a design state kept in a database.
    loadableDesignState: { filter: 'RullinoNoir' },
    updateStateFnRef: update,
    savingPixelRatio: 1, // Konva runs the filter again at the saving size: 1 keeps it quick on a 2 MP photo
    onSave: ({ imageBase64, fullName }) => {
      const a = Object.assign(document.createElement('a'), { href: imageBase64, download: fullName });
      a.click();
    },
  }),
);

window.example = { update, Konva }; // for the smoke test
